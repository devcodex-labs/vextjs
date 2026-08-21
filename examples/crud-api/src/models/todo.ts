import type { VextModelDefinition } from "vextjs";

export interface TodoDocument {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

const TodoModel = {
  collection: "todos",
  schema: {
    id: "string:1-!",
    title: "string:1-120!",
    completed: "boolean!",
    createdAt: "datetime!",
  },
} satisfies VextModelDefinition<TodoDocument>;

export default TodoModel;
