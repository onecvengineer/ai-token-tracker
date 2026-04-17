export interface IModelConfig {
  listModels(): Promise<{ id: string; name: string; isCurrent: boolean }[]>;
  setModel(modelId: string): Promise<void>;
  getCurrentModel(): Promise<string>;
}

export interface IAccountConfig {
  listAccounts(): Promise<{ id: string; name: string; isActive: boolean }[]>;
  addAccount(name: string, config: Record<string, unknown>): Promise<void>;
  switchAccount(name: string): Promise<void>;
  removeAccount(name: string): Promise<void>;
  verifyAccount(name: string): Promise<boolean>;
}
