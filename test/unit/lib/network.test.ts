/**
 * src/lib/utils/network.ts 单元测试
 *
 * 测试覆盖：
 *   - getNetworkAddresses(): 正常获取、无网卡时空数组、过滤 loopback、过滤 IPv6、多网卡
 *   - printReadyLog(): host=0.0.0.0 多行展示（localhost + 127.0.0.1 + Network）
 *                      host=:: 触发多行、无外部网卡降级、具体 IP 单行、suffix 处理
 *
 * @see src/lib/utils/network.ts
 * @see requirements/启动日志网络地址增强/02-技术方案.md §8 测试策略
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mock node:os（必须在 import network.ts 之前，vitest 自动提升）──────────

vi.mock('node:os', () => ({
  networkInterfaces: vi.fn(() => ({})),
}))

import { networkInterfaces } from 'node:os'
import { getNetworkAddresses, printReadyLog } from '../../../src/lib/utils/network.js'

// ── 辅助工具 ─────────────────────────────────────────────────────────────────

type FakeIface = {
  address: string
  family: string
  internal: boolean
}

/**
 * 构造 os.networkInterfaces() 风格的返回值
 * 每个地址挂载在独立的 `ifaceN` 键下
 */
function buildNetIfaces(addrs: FakeIface[]): Record<string, FakeIface[]> {
  const result: Record<string, FakeIface[]> = {}
  for (let i = 0; i < addrs.length; i++) {
    result[`iface${i}`] = [addrs[i]!]
  }
  return result
}

/**
 * 创建轻量 logger stub，收集所有 .info(msg) 调用
 */
function createLogCapture(): {
  logger: { info(msg: string): void }
  messages: string[]
} {
  const messages: string[] = []
  return {
    logger: {
      info(msg: string) {
        messages.push(msg)
      },
    },
    messages,
  }
}

// ── getNetworkAddresses ───────────────────────────────────────────────────────

describe('getNetworkAddresses', () => {
  beforeEach(() => {
    vi.mocked(networkInterfaces).mockReset()
  })

  it('有局域网 IPv4 时返回地址列表', () => {
    vi.mocked(networkInterfaces).mockReturnValue(
      buildNetIfaces([
        { address: '192.168.1.158', family: 'IPv4', internal: false },
      ]) as ReturnType<typeof networkInterfaces>,
    )

    expect(getNetworkAddresses()).toEqual(['192.168.1.158'])
  })

  it('无外部网卡时返回空数组', () => {
    vi.mocked(networkInterfaces).mockReturnValue({})

    expect(getNetworkAddresses()).toEqual([])
  })

  it('networkInterfaces 返回 undefined 值时不崩溃', () => {
    vi.mocked(networkInterfaces).mockReturnValue(
      { lo: undefined } as ReturnType<typeof networkInterfaces>,
    )

    expect(getNetworkAddresses()).toEqual([])
  })

  it('过滤 loopback 地址（internal: true）', () => {
    vi.mocked(networkInterfaces).mockReturnValue(
      buildNetIfaces([
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '192.168.1.10', family: 'IPv4', internal: false },
      ]) as ReturnType<typeof networkInterfaces>,
    )

    expect(getNetworkAddresses()).toEqual(['192.168.1.10'])
  })

  it('过滤 IPv6 地址（family !== IPv4）', () => {
    vi.mocked(networkInterfaces).mockReturnValue(
      buildNetIfaces([
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '192.168.1.10', family: 'IPv4', internal: false },
      ]) as ReturnType<typeof networkInterfaces>,
    )

    expect(getNetworkAddresses()).toEqual(['192.168.1.10'])
  })

  it('多网卡时返回全部非 loopback IPv4 地址', () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false, cidr: null, mac: '', netmask: '' }],
      tun0: [{ address: '10.86.217.6', family: 'IPv4', internal: false, cidr: null, mac: '', netmask: '' }],
    } as ReturnType<typeof networkInterfaces>)

    expect(getNetworkAddresses()).toEqual(['192.168.1.10', '10.86.217.6'])
  })
})

// ── printReadyLog — host=0.0.0.0 多行模式 ────────────────────────────────────

describe('printReadyLog — host=0.0.0.0 多行展示', () => {
  beforeEach(() => {
    vi.mocked(networkInterfaces).mockReturnValue(
      buildNetIfaces([
        { address: '192.168.1.158', family: 'IPv4', internal: false },
      ]) as ReturnType<typeof networkInterfaces>,
    )
  })

  it('输出 ready 行 + Local(localhost) + Local(127.0.0.1) + Network 行', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '0.0.0.0', 3000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(4)
    expect(messages[0]).toBe('[vextjs] ready')
    expect(messages[1]).toContain('localhost:3000')
    expect(messages[1]).toContain('Local')
    expect(messages[2]).toContain('127.0.0.1:3000')
    expect(messages[2]).toContain('Local')
    expect(messages[3]).toContain('192.168.1.158:3000')
    expect(messages[3]).toContain('Network')
  })

  it('host=:: 同样触发多行展示', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '::', 8080, { prefix: '[vextjs]' })

    expect(messages[0]).toBe('[vextjs] ready')
    expect(messages[1]).toContain('localhost:8080')
    expect(messages[2]).toContain('127.0.0.1:8080')
  })

  it('无外部网卡时仅输出 ready + Local 双行，无 Network 行', () => {
    vi.mocked(networkInterfaces).mockReturnValue({})

    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '0.0.0.0', 3000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(3) // ready + localhost + 127.0.0.1
    expect(messages.every((m) => !m.includes('Network'))).toBe(true)
  })

  it('多网卡时每个 IP 各输出一行 Network', () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false, cidr: null, mac: '', netmask: '' }],
      tun0: [{ address: '10.86.217.6', family: 'IPv4', internal: false, cidr: null, mac: '', netmask: '' }],
    } as ReturnType<typeof networkInterfaces>)

    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '0.0.0.0', 3000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(5) // ready + localhost + 127.0.0.1 + 2×Network
    expect(messages[3]).toContain('192.168.1.10:3000')
    expect(messages[4]).toContain('10.86.217.6:3000')
  })

  it('suffix 附加到 ready 行，Local/Network 行不含 suffix', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '0.0.0.0', 3000, {
      prefix: '[vext dev]',
      suffix: '(soft reload enabled)',
    })

    expect(messages[0]).toBe('[vext dev] ready (soft reload enabled)')
    expect(messages[1]).not.toContain('soft reload')
    expect(messages[2]).not.toContain('soft reload')
  })
})

// ── printReadyLog — 具体 IP 单行模式 ─────────────────────────────────────────

describe('printReadyLog — 具体 IP 单行输出', () => {
  beforeEach(() => {
    // 单行模式不会调用 networkInterfaces，但保留 mock 以防意外调用
    vi.mocked(networkInterfaces).mockReset()
  })

  it('host=127.0.0.1 → 单行输出，不含 Local/Network', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '127.0.0.1', 3000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toBe('[vextjs] ready on http://127.0.0.1:3000')
  })

  it('host=192.168.1.100 → 单行输出指定 IP', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '192.168.1.100', 3000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toBe('[vextjs] ready on http://192.168.1.100:3000')
  })

  it('host=localhost 字符串 → 单行输出（非全量监听）', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, 'localhost', 4000, { prefix: '[vextjs]' })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toBe('[vextjs] ready on http://localhost:4000')
  })

  it('suffix 正确追加到单行输出末尾', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '127.0.0.1', 3000, {
      prefix: '[vextjs]',
      suffix: '(soft reload enabled)',
    })

    expect(messages[0]).toBe('[vextjs] ready on http://127.0.0.1:3000 (soft reload enabled)')
  })
})

// ── printReadyLog — suffix 边界 ───────────────────────────────────────────────

describe('printReadyLog — suffix 边界', () => {
  beforeEach(() => {
    vi.mocked(networkInterfaces).mockReturnValue(
      buildNetIfaces([
        { address: '192.168.1.1', family: 'IPv4', internal: false },
      ]) as ReturnType<typeof networkInterfaces>,
    )
  })

  it('suffix 为 undefined → 无多余空格，不含 "undefined"', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '0.0.0.0', 3000, { prefix: '[vextjs]' })

    expect(messages[0]).toBe('[vextjs] ready')
    expect(messages[0]).not.toContain('undefined')
    expect(messages[0]).not.toMatch(/\s$/)
  })

  it('单行模式 suffix 为 undefined → 输出不含多余空格', () => {
    const { logger, messages } = createLogCapture()

    printReadyLog(logger, '127.0.0.1', 3000, { prefix: '[vextjs]' })

    expect(messages[0]).toBe('[vextjs] ready on http://127.0.0.1:3000')
    expect(messages[0]).not.toMatch(/\s$/)
  })
})
