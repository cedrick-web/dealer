export const money = (amount: number) =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(amount || 0);

export const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded';

export const prettyStage = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
