import Feather from '@expo/vector-icons/Feather';
import {
  expensesCsv,
  type Expense,
  type ExpenseCategory,
  type MoneyPerson,
  type SettlementMethod,
  type SplitMethod,
} from '@tagalong/shared';
import { Platform, Share } from 'react-native';

type IconName = React.ComponentProps<typeof Feather>['name'];

export const CATEGORY_META: Record<ExpenseCategory, { label: string; icon: IconName }> = {
  food: { label: 'Food & drink', icon: 'coffee' },
  transport: { label: 'Transport', icon: 'navigation' },
  stay: { label: 'Stay', icon: 'home' },
  activity: { label: 'Activities', icon: 'compass' },
  shopping: { label: 'Shopping', icon: 'shopping-bag' },
  other: { label: 'Other', icon: 'tag' },
};

export const SPLIT_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  exact: 'Amounts',
  percent: 'Percent',
  shares: 'Shares',
};

export const SETTLEMENT_LABELS: Record<SettlementMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank or app',
  other: 'Other',
};

/**
 * What an expense starts with when it comes from elsewhere: a booking, a plan
 * item or a chat message. Passed to the Money tab as a route param.
 */
export interface ExpenseDraft {
  description?: string;
  amountMinor?: number;
  currency?: string;
  spentOn?: string;
  category?: ExpenseCategory;
  itemId?: string;
  bookingId?: string;
  sourceMessageId?: string;
}

export const encodeDraft = (draft: ExpenseDraft) => JSON.stringify(draft);

export const decodeDraft = (raw: string | undefined): ExpenseDraft | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? (value as ExpenseDraft) : null;
  } catch {
    return null;
  }
};

/** "You" for the signed-in person, their name for everyone else. */
export const nameOf = (people: MoneyPerson[], userId: string, me: string) =>
  userId === me ? 'You' : (people.find((p) => p.userId === userId)?.displayName ?? 'Someone');

/** A booking or plan item's type, as the closest expense category. */
export const categoryFor = (type: string): ExpenseCategory => {
  if (type === 'restaurant' || type === 'meal') return 'food';
  if (['flight', 'train', 'car', 'transport'].includes(type)) return 'transport';
  if (type === 'stay') return 'stay';
  if (type === 'ticket' || type === 'activity') return 'activity';
  return 'other';
};

/** Shares the trip's expenses as a CSV file, or downloads it on the web. */
export const exportCsv = async (
  tripName: string,
  expenses: Expense[],
  people: MoneyPerson[],
  baseCurrency: string,
) => {
  const name = (id: string) => people.find((p) => p.userId === id)?.displayName ?? 'Someone';
  const csv = expensesCsv(
    [...expenses]
      .sort((a, b) => (a.spentOn < b.spentOn ? -1 : a.spentOn > b.spentOn ? 1 : 0))
      .map((e) => ({
        spentOn: e.spentOn,
        description: e.description,
        category: e.category,
        paidByName: name(e.paidBy),
        amountMinor: e.amountMinor,
        currency: e.currency,
        baseAmountMinor: e.baseAmountMinor,
        shares: e.splits.map((s) => ({ name: name(s.userId), shareMinor: s.shareMinor })),
      })),
    people.map((p) => p.displayName),
    baseCurrency,
  );
  const fileName = `${tripName.replace(/[^\w -]+/g, '').trim() || 'trip'} expenses.csv`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const uri = `${FileSystem.cacheDirectory}${encodeURIComponent(fileName)}`;
  await FileSystem.writeAsStringAsync(uri, csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: fileName, UTI: 'public.comma-separated-values-text' });
  } else {
    await Share.share({ message: csv });
  }
};
