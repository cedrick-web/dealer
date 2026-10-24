import type { Listing } from '@/api';

export const money = (amount: number) =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(amount || 0);

const illustrationIds = [
  'photo-1600596542815-ffad4c1539a9',
  'photo-1600607687939-ce8a6c25118c',
  'photo-1600607687920-4e2a09cf159d',
  'photo-1600566753086-00f18fb6b3ea',
  'photo-1500382017468-9049fed747ef',
  'photo-1511818966892-d7d671e672a2',
] as const;

/** Illustrative artwork only; never treat it as a photo of the advertised property. */
export const photoFor = (listing: Listing) => {
  const type = listing.propertyType;
  const id =
    type === 'land' ? illustrationIds[4] :
    type === 'apartment' ? illustrationIds[1] :
    type === 'commercial' ? illustrationIds[5] :
    illustrationIds[0];

  return 'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=1000&q=82';
};

export const prettyStage = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
