export type InstanceType<T> = T extends new (...args: any[]) => infer R ? R : never;
