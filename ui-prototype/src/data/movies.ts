export interface Movie {
  id: string;
  title: string;
  year: number;
  genre: string;
  thumb: string;
  runtime: string;
  license: "publicdomain" | "creativecommons";
}

const thumb = (id: string) => `https://archive.org/services/img/${id}`;

export const movies: Movie[] = [
  { id: "it-1927", title: "It", year: 1927, genre: "Romance · Silent", thumb: thumb("it-1927"), runtime: "1h 12m", license: "publicdomain" },
  { id: "hard-boiled-1992", title: "Hard Boiled", year: 1992, genre: "Action · Hong Kong", thumb: thumb("hard-boiled-1992"), runtime: "2h 8m", license: "creativecommons" },
  { id: "night-of-the-living-dead-1968-english", title: "Night of the Living Dead", year: 1968, genre: "Horror", thumb: thumb("night-of-the-living-dead-1968-english"), runtime: "1h 36m", license: "publicdomain" },
  { id: "the-killer-1989", title: "The Killer", year: 1989, genre: "Action · Hong Kong", thumb: thumb("the-killer-1989"), runtime: "1h 50m", license: "creativecommons" },
  { id: "a-better-tomorrow-a-better-tomorrow-ii-english-dubbed", title: "A Better Tomorrow", year: 1986, genre: "Crime · Hong Kong", thumb: thumb("a-better-tomorrow-a-better-tomorrow-ii-english-dubbed"), runtime: "1h 35m", license: "creativecommons" },
  { id: "planes_trains_and_automobiles", title: "Planes, Trains & Automobiles", year: 1987, genre: "Comedy", thumb: thumb("planes_trains_and_automobiles"), runtime: "1h 33m", license: "publicdomain" },
  { id: "detour", title: "Detour", year: 1945, genre: "Film Noir", thumb: thumb("detour"), runtime: "1h 8m", license: "publicdomain" },
  { id: "the-batman-1966", title: "Batman: The Movie", year: 1966, genre: "Comedy · Superhero", thumb: thumb("the-batman-1966"), runtime: "1h 45m", license: "publicdomain" },
];
