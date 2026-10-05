export interface StateStore {
  read<T>(key: string): Promise<T | undefined>;
  write<T>(key: string, value: T): Promise<void>;
  // Native desktop stores can commit before a UI mutation returns.
  writeSync?<T>(key: string, value: T): void;
  readAll(): Promise<Record<string, unknown>>;
  replaceAll(values: Record<string, unknown>): Promise<void>;
}
