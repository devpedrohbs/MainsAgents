export interface StateStore {
  read<T>(key: string): Promise<T | undefined>;
  write<T>(key: string, value: T): Promise<void>;
  readAll(): Promise<Record<string, unknown>>;
  replaceAll(values: Record<string, unknown>): Promise<void>;
}
