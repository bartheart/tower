// mobile/src/navigation/types.ts
export type RootStackParamList = {
  Tabs: undefined;
  LinkedAccounts: undefined;
  Profile: undefined;
  Notifications: undefined;
  Preferences: undefined;
  About: undefined;
};

export type TabParamList = {
  Home: undefined;
  Spend: { budgetId?: string; period?: string } | undefined;
  Plan: { planningTab?: string } | undefined;
  Settings: undefined;
};
