import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);
const WINDOWS_SUPPORTED_MAX_CPU = 62;

function assertPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process ID: ${String(pid)}`);
  }
}

function assertWindows() {
  if (process.platform !== "win32") {
    throw new Error(
      `Windows benchmark protocol cannot run on ${process.platform}`,
    );
  }
}

async function runPowerShell(script) {
  assertWindows();
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${script}`,
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  return result.stdout.trim();
}

async function runPowerShellJson(script) {
  const output = await runPowerShell(
    `$ErrorActionPreference = 'Stop'; ${script}`,
  );
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`PowerShell did not produce JSON: ${output}`, {
      cause: error,
    });
  }
}

export function parseCpuSet(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("CPU set must be a non-empty list such as 0-3,6-7");
  }
  const cpus = new Set();
  for (const rawPart of value.split(",")) {
    const [startRaw, endRaw] = rawPart.trim().split("-");
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error(`Invalid CPU set entry: ${rawPart}`);
    }
    for (let cpu = start; cpu <= end; cpu += 1) cpus.add(cpu);
  }
  return cpus;
}

export function formatCpuSet(cpus) {
  return [...cpus].sort((left, right) => left - right).join(",");
}

export function sameCpuSet(left, right) {
  return left.size === right.size && [...left].every((cpu) => right.has(cpu));
}

function windowsMask(cpuSet) {
  const cpus = parseCpuSet(cpuSet);
  if ([...cpus].some((cpu) => cpu > WINDOWS_SUPPORTED_MAX_CPU)) {
    throw new Error(
      `Windows ProcessorAffinity supports this protocol only through CPU ${WINDOWS_SUPPORTED_MAX_CPU}`,
    );
  }
  return [...cpus].reduce((mask, cpu) => mask | (1n << BigInt(cpu)), 0n);
}

function cpuSetFromWindowsMask(rawMask) {
  const mask = BigInt(String(rawMask).trim());
  if (mask < 0n) {
    throw new Error("Windows ProcessorAffinity returned a negative CPU mask");
  }
  const cpus = new Set();
  for (let cpu = 0; cpu <= WINDOWS_SUPPORTED_MAX_CPU; cpu += 1) {
    if ((mask & (1n << BigInt(cpu))) !== 0n) cpus.add(cpu);
  }
  if (cpus.size === 0)
    throw new Error("Windows ProcessorAffinity returned no CPU");
  return cpus;
}

export async function readProcessCpuSet(pid) {
  assertPid(pid);
  const output = await runPowerShell(
    `(Get-Process -Id ${pid}).ProcessorAffinity.ToInt64()`,
  );
  return cpuSetFromWindowsMask(output);
}

export async function setProcessCpuSet(pid, cpuSet) {
  assertPid(pid);
  const requested = parseCpuSet(cpuSet);
  const mask = windowsMask(formatCpuSet(requested));
  await runPowerShell(
    `$target = Get-Process -Id ${pid}; $target.ProcessorAffinity = [IntPtr]::new([Int64]${mask})`,
  );
  const actual = await readProcessCpuSet(pid);
  if (!sameCpuSet(actual, requested)) {
    throw new Error(
      `Process ${pid} affinity ${formatCpuSet(actual)} does not match ${formatCpuSet(requested)}`,
    );
  }
  return actual;
}

export async function getOwnedProcessTreePids(rootPid) {
  assertPid(rootPid);
  const result = await runPowerShellJson(`
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue(${rootPid})
    $result = [System.Collections.Generic.List[int]]::new()
    while ($queue.Count -gt 0) {
      $current = $queue.Dequeue()
      if ($result.Contains($current)) { continue }
      $result.Add($current)
      foreach ($child in $all | Where-Object { [int]$_.ParentProcessId -eq $current }) {
        $queue.Enqueue([int]$child.ProcessId)
      }
    }
    @{ pids = @($result) } | ConvertTo-Json -Compress
  `);
  return [...new Set((result.pids ?? []).map(Number))].sort(
    (left, right) => left - right,
  );
}

export async function setAndVerifyProcessTreeCpuSet(rootPid, cpuSet) {
  const result = await setAndVerifyProcessTreesCpuSets([
    { role: "single", rootPid, cpuSet },
  ]);
  return result.single;
}

/**
 * Applies and reads back every currently known descendant of multiple owned
 * roots in one PowerShell invocation. This stays outside the timed window but
 * prevents qualification bookkeeping from dominating a long formal batch.
 */
export async function setAndVerifyProcessTreesCpuSets(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error(
      "At least one owned process-tree affinity assignment is required",
    );
  }
  const seenRoles = new Set();
  const normalized = assignments.map((assignment) => {
    const role = String(assignment?.role ?? "");
    assertPid(assignment?.rootPid);
    if (!role || seenRoles.has(role)) {
      throw new Error(
        `Affinity assignment role must be unique: ${role || "missing"}`,
      );
    }
    seenRoles.add(role);
    const cpuSet = formatCpuSet(parseCpuSet(assignment?.cpuSet));
    return {
      role,
      rootPid: assignment.rootPid,
      cpuSet,
      mask: windowsMask(cpuSet).toString(),
    };
  });
  const assignmentLiteral = normalized
    .map(
      (assignment) =>
        "@{ role = '" +
        assignment.role.replaceAll("'", "''") +
        "'; rootPid = " +
        assignment.rootPid +
        "; mask = '" +
        assignment.mask +
        "' }",
    )
    .join(",");
  const result = await runPowerShellJson(`
    $assignments = @(${assignmentLiteral})
    function Get-Descendants($rootPid, $processes) {
      $queue = [System.Collections.Generic.Queue[int]]::new()
      $queue.Enqueue([int]$rootPid)
      $seen = [System.Collections.Generic.List[int]]::new()
      while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if ($seen.Contains($current)) { continue }
        $seen.Add($current)
        foreach ($child in $processes | Where-Object { [int]$_.ParentProcessId -eq $current }) {
          $queue.Enqueue([int]$child.ProcessId)
        }
      }
      return @($seen)
    }
    function Set-TreeAffinity($pids, $mask) {
      foreach ($ownedPid in $pids) {
        $target = Get-Process -Id $ownedPid
        $target.ProcessorAffinity = [IntPtr]::new([Int64]$mask)
      }
    }
    $firstProcessTable = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    foreach ($assignment in $assignments) {
      Set-TreeAffinity (Get-Descendants $assignment.rootPid $firstProcessTable) $assignment.mask
    }
    $secondProcessTable = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $proof = @()
    foreach ($assignment in $assignments) {
      $pids = @(Get-Descendants $assignment.rootPid $secondProcessTable)
      Set-TreeAffinity $pids $assignment.mask
      $entries = @()
      foreach ($ownedPid in $pids) {
        $actual = (Get-Process -Id $ownedPid).ProcessorAffinity.ToInt64()
        $entries += @{ pid = [int]$ownedPid; affinityMask = [string]$actual }
      }
      $proof += @{ role = $assignment.role; entries = $entries }
    }
    @{ assignments = $proof } | ConvertTo-Json -Compress -Depth 7
  `);
  const byRole = new Map(
    normalizeArray(result.assignments).map((assignment) => [
      assignment.role,
      assignment,
    ]),
  );
  const verified = {};
  for (const assignment of normalized) {
    const proof = byRole.get(assignment.role);
    const entries = normalizeArray(proof?.entries);
    if (entries.length === 0) {
      throw new Error(
        `Owned process tree ${assignment.role} has no affinity proof`,
      );
    }
    const requested = parseCpuSet(assignment.cpuSet);
    verified[assignment.role] = entries.map((entry) => {
      const actual = cpuSetFromWindowsMask(entry.affinityMask);
      if (!sameCpuSet(actual, requested)) {
        throw new Error(
          `Child process ${entry.pid} affinity ${formatCpuSet(actual)} does not match ${assignment.cpuSet}`,
        );
      }
      return { pid: Number(entry.pid), cpuSet: formatCpuSet(actual) };
    });
  }
  return verified;
}

function bitsFromMask(mask) {
  const value = BigInt(mask);
  if (value <= 0n || value >> BigInt(WINDOWS_SUPPORTED_MAX_CPU + 1)) {
    throw new Error("Processor group mask is outside the safe affinity range");
  }
  const cpus = new Set();
  for (let cpu = 0; cpu <= WINDOWS_SUPPORTED_MAX_CPU; cpu += 1) {
    if ((value & (1n << BigInt(cpu))) !== 0n) cpus.add(cpu);
  }
  return cpus;
}

const topologyPowerShell = String.raw`
$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class VextBenchmarkCpuTopology
{
    [StructLayout(LayoutKind.Sequential)]
    private struct GroupAffinity
    {
        public UIntPtr Mask;
        public ushort Group;
        public ushort Reserved0;
        public ushort Reserved1;
        public ushort Reserved2;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessorRelationship
    {
        public byte Flags;
        public byte EfficiencyClass;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 20)]
        public byte[] Reserved;
        public ushort GroupCount;
        public GroupAffinity GroupMask;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetLogicalProcessorInformationEx(
        int relationshipType,
        IntPtr buffer,
        ref uint returnedLength);

    public static string[] GetCoreMasks()
    {
        uint length = 0;
        GetLogicalProcessorInformationEx(0, IntPtr.Zero, ref length);
        int firstError = Marshal.GetLastWin32Error();
        if (length == 0)
        {
            throw new Win32Exception(firstError);
        }

        IntPtr buffer = Marshal.AllocHGlobal((int)length);
        try
        {
            if (!GetLogicalProcessorInformationEx(0, buffer, ref length))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var masks = new List<string>();
            int offset = 0;
            while (offset < length)
            {
                int relationship = Marshal.ReadInt32(buffer, offset);
                int size = Marshal.ReadInt32(buffer, offset + 4);
                if (size <= 8 || offset + size > length)
                {
                    throw new InvalidOperationException("Invalid logical processor topology record");
                }

                if (relationship == 0)
                {
                    var processor = (ProcessorRelationship)Marshal.PtrToStructure(
                        IntPtr.Add(buffer, offset + 8),
                        typeof(ProcessorRelationship));
                    if (processor.GroupCount != 1)
                    {
                        throw new InvalidOperationException("A processor core spans multiple groups");
                    }
                    masks.Add(processor.GroupMask.Group + ":" + processor.GroupMask.Mask.ToUInt64());
                }
                offset += size;
            }
            return masks.ToArray();
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}
'@
Add-Type -TypeDefinition $source
$os = Get-CimInstance Win32_OperatingSystem
$processors = @(Get-CimInstance Win32_Processor | ForEach-Object {
  @{ name = $_.Name; cores = $_.NumberOfCores; logical = $_.NumberOfLogicalProcessors }
})
$battery = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | ForEach-Object {
  @{ status = $_.BatteryStatus; charge = $_.EstimatedChargeRemaining }
})
$powerPlan = (& powercfg /GETACTIVESCHEME | Out-String).Trim()
@{
  os = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber }
  processors = $processors
  batteries = $battery
  powerPlan = $powerPlan
  totalMemoryBytes = [string]([UInt64]$os.TotalVisibleMemorySize * 1024)
  coreMasks = @([VextBenchmarkCpuTopology]::GetCoreMasks())
} | ConvertTo-Json -Compress -Depth 6
`;

function normalizeArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export async function inspectWindowsHost() {
  const raw = await runPowerShellJson(topologyPowerShell);
  const physicalCores = normalizeArray(raw.coreMasks)
    .map((entry, index) => {
      const [groupRaw, maskRaw] = String(entry).split(":");
      return {
        id: `core-${index}`,
        group: Number(groupRaw),
        logicalCpus: bitsFromMask(maskRaw),
      };
    })
    .sort((left, right) => {
      const leftCpu = Math.min(...left.logicalCpus);
      const rightCpu = Math.min(...right.logicalCpus);
      return left.group - right.group || leftCpu - rightCpu;
    });
  const logicalCpus = new Set(
    physicalCores.flatMap((core) => [...core.logicalCpus]),
  );
  return {
    os: raw.os,
    processors: normalizeArray(raw.processors),
    batteries: normalizeArray(raw.batteries),
    powerPlan: String(raw.powerPlan ?? ""),
    totalMemoryBytes: String(raw.totalMemoryBytes ?? ""),
    physicalCores: physicalCores.map((core) => ({
      id: core.id,
      group: core.group,
      logicalCpus: [...core.logicalCpus].sort((left, right) => left - right),
    })),
    logicalCpuCount: logicalCpus.size,
  };
}

function eligiblePhysicalCores(host) {
  return host.physicalCores
    .filter(
      (core) =>
        core.group === 0 &&
        core.logicalCpus.every((cpu) => cpu <= WINDOWS_SUPPORTED_MAX_CPU),
    )
    .map((core) => ({ ...core, logicalCpus: new Set(core.logicalCpus) }));
}

function coreBackgroundScore(core, background) {
  const byCpu = new Map(
    normalizeArray(background?.cpus).map((entry) => [Number(entry.cpu), entry]),
  );
  const values = [...core.logicalCpus].map((cpu) =>
    Number(byCpu.get(cpu)?.average),
  );
  if (values.some((value) => !Number.isFinite(value)))
    return Number.POSITIVE_INFINITY;
  return Math.max(...values);
}

export function selectRoleCores(host, background) {
  const eligible = eligiblePhysicalCores(host);
  if (eligible.length < 4) {
    throw new Error(
      "Host requires at least four independently mappable physical cores",
    );
  }
  const ranked = eligible
    .map((core) => ({
      ...core,
      backgroundAveragePercent: coreBackgroundScore(core, background),
      firstLogicalCpu: Math.min(...core.logicalCpus),
    }))
    .sort(
      (left, right) =>
        left.backgroundAveragePercent - right.backgroundAveragePercent ||
        left.firstLogicalCpu - right.firstLogicalCpu,
    );
  const selected = ranked
    .slice(0, 4)
    .sort((left, right) => left.firstLogicalCpu - right.firstLogicalCpu);
  return {
    candidates: ranked.map((core) => ({
      id: core.id,
      logicalCpus: [...core.logicalCpus].sort((left, right) => left - right),
      backgroundAveragePercent: core.backgroundAveragePercent,
      selected: selected.some((entry) => entry.id === core.id),
    })),
    selected,
  };
}

export function allocateRoleCpuSets(host, { background } = {}) {
  const selected = background
    ? selectRoleCores(host, background).selected
    : eligiblePhysicalCores(host).slice(0, 4);
  if (selected.length < 4) {
    throw new Error(
      "Host requires four selected physical cores for benchmark roles",
    );
  }
  const roles = {
    load: selected[0].logicalCpus,
    target: selected[1].logicalCpus,
    dependency: selected[2].logicalCpus,
    control: selected[3].logicalCpus,
  };
  if ([...Object.values(roles)].some((cpuSet) => cpuSet.size === 0)) {
    throw new Error(
      "Host cannot form non-empty load/target/dependency/control CPU sets",
    );
  }
  const all = Object.values(roles).flatMap((cpuSet) => [...cpuSet]);
  if (new Set(all).size !== all.length) {
    throw new Error("Role CPU sets overlap");
  }
  return Object.fromEntries(
    Object.entries(roles).map(([role, cpuSet]) => [role, formatCpuSet(cpuSet)]),
  );
}

async function sampleLogicalCpuUtilization(cpus, seconds) {
  const selected = [...cpus].sort((left, right) => left - right).join(",");
  return runPowerShellJson(`
    $selected = @(${selected})
    $totals = @{}
    $maximums = @{}
    $counts = @{}
    foreach ($cpu in $selected) {
      $totals[$cpu] = 0.0
      $maximums[$cpu] = 0.0
      $counts[$cpu] = 0
    }
    for ($sample = 0; $sample -lt ${seconds}; $sample += 1) {
      foreach ($entry in Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor) {
        if ([string]$entry.Name -notmatch '^\\d+$') { continue }
        $cpu = [int]$entry.Name
        if ($selected -notcontains $cpu) { continue }
        $value = [double]$entry.PercentProcessorTime
        $totals[$cpu] += $value
        if ($value -gt $maximums[$cpu]) { $maximums[$cpu] = $value }
        $counts[$cpu] += 1
      }
      Start-Sleep -Seconds 1
    }
    $items = @()
    foreach ($cpu in $selected) {
      $count = [int]$counts[$cpu]
      $items += @{
        cpu = [int]$cpu
        average = if ($count -gt 0) { [math]::Round($totals[$cpu] / $count, 3) } else { $null }
        max = [math]::Round($maximums[$cpu], 3)
        samples = $count
      }
    }
    @{ durationSeconds = ${seconds}; cpus = $items } | ConvertTo-Json -Compress -Depth 4
  `);
}

function roleBackgroundSummary(roleSets, samples) {
  const byCpu = new Map(
    normalizeArray(samples.cpus).map((entry) => [Number(entry.cpu), entry]),
  );
  return Object.fromEntries(
    Object.entries(roleSets).map(([role, cpuSet]) => {
      const values = [...parseCpuSet(cpuSet)].map((cpu) => byCpu.get(cpu));
      const missing = values.some((value) => !value || value.average === null);
      const average = missing
        ? null
        : Math.max(...values.map((value) => Number(value.average)));
      return [role, { maxLogicalCpuAverage: average, details: values }];
    }),
  );
}

function batteryAllowsFormalRun(batteries) {
  if (batteries.length === 0) return true;
  return batteries.every((battery) =>
    [2, 3, 6, 7, 8, 9].includes(Number(battery.status)),
  );
}

export async function qualifyWindowsHost({
  backgroundSeconds = 60,
  maxBackgroundPercent = 10,
} = {}) {
  if (!Number.isInteger(backgroundSeconds) || backgroundSeconds < 1) {
    throw new Error("backgroundSeconds must be a positive integer");
  }
  const host = await inspectWindowsHost();
  const reasons = [];
  if (host.logicalCpuCount < 6)
    reasons.push("fewer than six safe logical CPUs");
  if (
    /power saver/iu.test(host.powerPlan) ||
    /a1841308-3541-4fab-bc81-f71556f20b4a/iu.test(host.powerPlan)
  ) {
    reasons.push("Power Saver plan is active");
  }
  if (!batteryAllowsFormalRun(host.batteries))
    reasons.push("battery is not on AC/charging state");
  let candidates;
  let candidateCpuSet;
  try {
    candidates = eligiblePhysicalCores(host);
    if (candidates.length < 4) {
      throw new Error(
        "Host requires at least four independently mappable physical cores",
      );
    }
    candidateCpuSet = candidates.flatMap((core) => [...core.logicalCpus]);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  const background = candidateCpuSet
    ? await sampleLogicalCpuUtilization(candidateCpuSet, backgroundSeconds)
    : null;
  let roleCpuSets;
  let roleSelection;
  try {
    roleSelection = selectRoleCores(host, background);
    roleCpuSets = allocateRoleCpuSets(host, { background });
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  const roleBackground = background
    ? roleBackgroundSummary(roleCpuSets, background)
    : null;
  if (roleBackground) {
    for (const [role, summary] of Object.entries(roleBackground)) {
      if (
        summary.maxLogicalCpuAverage === null ||
        summary.maxLogicalCpuAverage > maxBackgroundPercent
      ) {
        reasons.push(`${role} background CPU exceeds ${maxBackgroundPercent}%`);
      }
    }
  }
  return {
    status: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    host,
    roleCpuSets,
    roleSelection: roleSelection
      ? {
          method:
            "all-safe-physical-cores-sampled; lowest-background-average-then-logical-cpu-selected",
          candidates: roleSelection.candidates,
          roles: Object.fromEntries(
            ["load", "target", "dependency", "control"].map((role, index) => [
              role,
              {
                coreId: roleSelection.selected[index].id,
                logicalCpus: [
                  ...roleSelection.selected[index].logicalCpus,
                ].sort((left, right) => left - right),
              },
            ]),
          ),
        }
      : null,
    background,
    roleBackground,
    policy: {
      maxControlledCpu: WINDOWS_SUPPORTED_MAX_CPU,
      backgroundSeconds,
      maxBackgroundPercent,
      affinityScope:
        "single Processor Group 0; deterministically selected physical-core role partition",
    },
  };
}

export async function snapshotProcessTreeMetrics(rootPid) {
  const pids = await getOwnedProcessTreePids(rootPid);
  const values = [];
  for (const pid of pids) {
    const metric = await runPowerShellJson(`
      $process = Get-Process -Id ${pid}
      $cpuSeconds = if ($null -eq $process.CPU) { 0 } else { [double]$process.CPU }
      @{
        pid = ${pid}
        cpuSeconds = $cpuSeconds
        workingSetBytes = [string]$process.WorkingSet64
        peakWorkingSetBytes = [string]$process.PeakWorkingSet64
      } | ConvertTo-Json -Compress
    `);
    values.push(metric);
  }
  return {
    pids,
    cpuSeconds: values.reduce(
      (total, value) => total + Number(value.cpuSeconds),
      0,
    ),
    workingSetBytes: values.reduce(
      (total, value) => total + BigInt(value.workingSetBytes ?? 0),
      0n,
    ),
    peakWorkingSetBytes: values.reduce(
      (total, value) => total + BigInt(value.peakWorkingSetBytes ?? 0),
      0n,
    ),
    processes: values,
  };
}
