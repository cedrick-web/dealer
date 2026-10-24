export const money = (amount: number) =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(amount || 0);

export const prettyStage = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
