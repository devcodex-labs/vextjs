import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";
import type { TodoDocument } from "../models/todo.js";

export interface UpdateTodoInput {
  title?: string;
  completed?: boolean;
}

export default class TodoService {
  constructor(private readonly app: VextApp) {}

  private get model() {
    const database = this.app.db;
    if (!database) {
      throw new Error("[crud-api] app.db is unavailable");
    }
    return database.model<TodoDocument>("todos");
  }

  async list(limit: number = 20): Promise<TodoDocument[]> {
    return this.model.find({}, { limit, sort: { createdAt: -1 } });
  }

  async find(id: string): Promise<TodoDocument> {
    const todo = await this.model.findOne({ id });
    if (!todo) this.app.throw(404, "Todo not found", "TODO_NOT_FOUND");
    return todo;
  }

  async create(title: string): Promise<TodoDocument> {
    const todo: TodoDocument = {
      id: randomUUID(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    await this.model.insertOne(todo);
    return todo;
  }

  async update(id: string, patch: UpdateTodoInput): Promise<TodoDocument> {
    const current = await this.find(id);
    await this.model.upsertOne({ id }, { $set: patch });
    return { ...current, ...patch };
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.model.deleteOne({ id });
  }
}
