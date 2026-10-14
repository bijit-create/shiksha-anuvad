// Translation rules, written against the tests of the ConveGenius T-QSI policy v1.0 (E1–E9 errors, N/P/C quality).
// Each rule names what the scorer checks, so a translation that follows them scores without findings.

export function translationRules(target: string, opts: { item: boolean }): string {
  const hi = target === 'Hindi', te = target === 'Telugu';
  const article = hi ? '"एक"' : te ? '"ఒక"' : `the ${target} word for "a/one"`;
  const participle = hi ? '"…की जाने वाली X"' : te ? '"…చేయబడిన X"' : 'a passive participle phrase';
  const relative = hi ? '"जो …"' : te ? '"ఏదైతే …"' : 'a relative clause';
  const stop = hi ? ' Hindi sentences end with "।".' : '';

  const keep = [
    'Every number, digit for digit, in the same field. Do not turn numerals into words or words into numerals.',
    'Mathematical notation: variables, letters that name points, lines or shapes (LMN, AB, ∠PQR), symbols and operators.',
  ];
  if (opts.item) {
    keep.push(
      'Image references ("[image] /uploads/…", "/uploads/…") exactly as written.',
      'Blank markers (___, #), the answer separator "$" and line breaks, in the same places.',
      'The number of options, blanks and answer parts. Never add, drop, merge or reorder options.',
    );
  }

  const meaning = [
    'The same task: the same operation, the same number of answers, the same direction (increasing/decreasing, more/less), and every negation (not, never, except).',
    'The same referents, quantities, qualifiers and names: "length" is not "width", "about" is not dropped, "boy" is not "son". Add nothing, drop nothing.',
  ];
  if (opts.item) {
    meaning.push(
      'The key names the same option as in English: the answer field is exactly the translated text of the option it matches.',
      `Translate every word option and the key into ${target}; an option left in English makes the item unanswerable.`,
    );
  }

  return [
    `KEEP UNCHANGED`,
    ...keep.map(s => `- ${s}`),
    ``,
    `KEEP THE MEANING`,
    ...meaning.map(s => `- ${s}`),
    ``,
    `TERMS`,
    `- Where the glossary below gives a ${target} term, use it (inflect only as grammar needs). Otherwise use the term printed in NCERT ${target}-medium textbooks for the grade.`,
    `- Do not put the English term in brackets after the ${target} term.`,
    `- No English words in Latin script, except the units and abbreviations the glossary section allows and letters that label points or shapes. Everything else is in ${target} script.`,
    ``,
    `LANGUAGE: school-textbook ${target}`,
    `- Correct spelling, gender, number agreement and case endings; ${target} punctuation.${stop}`,
    `- A complete sentence with a finite verb wherever the English has one. A question stays a question.`,
    `- Plain, natural wording, as a textbook would print it:`,
    `  - no ${article} before each item of a list or comparison unless the sense needs it;`,
    `  - a short noun phrase rather than ${participle};`,
    `  - a direct sentence rather than ${relative};`,
    `  - the plainer of two correct words.`,
    ...(opts.item ? [`- Each option, put into the blank, must read as a correct sentence (particles, agreement, verb).`] : []),
    `- A pronoun or "this/that" must point to the same noun as in the English.`,
    `- Grades 1–5: short sentences and everyday words. Grades 6–10: the textbook's subject terms.`,
  ].join('\n');
}
