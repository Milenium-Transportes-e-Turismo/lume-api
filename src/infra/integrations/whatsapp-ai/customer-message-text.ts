function words(text: string): string[] {
  return text.normalize('NFC').match(/[\p{L}\p{M}]+/gu) ?? [];
}

/** Reject unsupported generated alphabets in Portuguese replies; preserve supplied names. */
export function hasUnexpectedMixedAlphabetWord(
  message: string,
  customerText: readonly string[],
): boolean {
  const suppliedWords = new Set(
    customerText.flatMap(words).map((word) => word.toLowerCase()),
  );
  return words(message).some((word) => {
    const letters = word.replace(/\p{M}/gu, '');
    return (
      /[^\p{Script_Extensions=Latin}]/u.test(letters) &&
      !suppliedWords.has(word.toLowerCase())
    );
  });
}
