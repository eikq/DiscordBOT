export type JsonCollection<T> = {
  load(): T[];
  replace(items: T[]): void;
};
