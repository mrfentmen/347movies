import { useEffect, useState } from "react";
import { MovieCard } from "@/components/movie-card";
import { MovieHeader } from "@/components/movie-header";
import { movies } from "@/data/movies";

function Header({ onHome }: { onHome: () => void }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/92 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-6 px-4">
        <a href="#/" onClick={onHome} className="font-display text-[1.3rem] tracking-[2px] text-accent">
          347movies
        </a>
        <nav className="flex items-center gap-5 text-sm text-muted-foreground" aria-label="Main">
          <a href="#/" className="text-foreground" onClick={onHome}>Home</a>
          <a href="#/" onClick={onHome}>Browse</a>
          <a href="#/" onClick={onHome}>Watchlist</a>
        </nav>
        <span className="film-slate ml-auto hidden text-muted-foreground md:block">
          shadcn/ui prototype
        </span>
      </div>
    </header>
  );
}

export default function App() {
  const [route, setRoute] = useState<string>(window.location.hash);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const match = route.match(/^#\/movie\/(.+)$/);
  const movie = match ? movies.find((m) => m.id === match[1]) : undefined;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onHome={() => setRoute("#/")} />
      <main id="main" className="pt-8">
        {movie ? (
          <MovieHeader movie={movie} />
        ) : (
          <section className="mx-auto w-full max-w-[1120px] px-4">
            <p className="film-slate text-accent">The projection booth</p>
            <div className="mb-6 flex items-baseline justify-between">
              <h1 className="font-display text-3xl leading-tight text-foreground md:text-[3.1rem] md:tracking-[1px]">
                Free movies. No interruptions. Ever.
              </h1>
              <span className="film-slate hidden text-muted-foreground md:block">8 films</span>
            </div>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {movies.map((m) => (
                <MovieCard key={m.id} movie={m} onSave={() => {}} />
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="mt-12 border-t border-border py-7">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4">
          <p className="font-display text-sm tracking-[1px] text-accent">
            Free movies. No interruptions. Ever.
          </p>
          <p className="film-slate text-muted-foreground">
            Sandbox prototype — the live site stays vanilla by design
          </p>
        </div>
      </footer>
    </div>
  );
}
