/**
 * Genre taxonomy used by browse. Keys are URL-safe; values are archive.org subject terms.
 */
export const GENRE_SUBJECTS: Record<string, string> = {
  "film-noir": "film noir",
  western: "western",
  "sci-fi": "science fiction",
  horror: "horror",
  silent: "silent films",
  comedy: "comedy",
  drama: "drama",
};

export const GENRE_LABELS: Record<string, string> = {
  "film-noir": "Film Noir",
  western: "Western",
  "sci-fi": "Sci-Fi",
  horror: "Horror",
  silent: "Silent",
  comedy: "Comedy",
  drama: "Drama",
};

export type GenreKey = keyof typeof GENRE_SUBJECTS;

export const GENRE_KEYS: GenreKey[] = Object.keys(GENRE_SUBJECTS) as GenreKey[];
