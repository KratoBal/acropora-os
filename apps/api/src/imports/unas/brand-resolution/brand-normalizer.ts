export const normalizeBrandText = (value: string) =>
  value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export const containsTokenPhrase = (value: string, phrase: string) => {
  const normalizedValue = normalizeBrandText(value);
  const normalizedPhrase = normalizeBrandText(phrase);
  return Boolean(
    normalizedPhrase &&
    ` ${normalizedValue} `.includes(` ${normalizedPhrase} `),
  );
};

export const startsWithTokenPhrase = (value: string, phrase: string) => {
  const normalizedValue = normalizeBrandText(value);
  const normalizedPhrase = normalizeBrandText(phrase);
  return (
    normalizedValue === normalizedPhrase ||
    normalizedValue.startsWith(`${normalizedPhrase} `)
  );
};
