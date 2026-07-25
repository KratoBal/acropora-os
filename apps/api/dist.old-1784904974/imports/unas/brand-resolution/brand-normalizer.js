export const normalizeBrandText = (value) => value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export const containsTokenPhrase = (value, phrase) => {
    const normalizedValue = normalizeBrandText(value);
    const normalizedPhrase = normalizeBrandText(phrase);
    return Boolean(normalizedPhrase &&
        ` ${normalizedValue} `.includes(` ${normalizedPhrase} `));
};
export const startsWithTokenPhrase = (value, phrase) => {
    const normalizedValue = normalizeBrandText(value);
    const normalizedPhrase = normalizeBrandText(phrase);
    return (normalizedValue === normalizedPhrase ||
        normalizedValue.startsWith(`${normalizedPhrase} `));
};
//# sourceMappingURL=brand-normalizer.js.map