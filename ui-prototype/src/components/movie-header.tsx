import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Movie } from "@/data/movies";

const licenseLabel = (m: Movie) => (m.license === "publicdomain" ? "Public Domain" : "Creative Commons");

export function MovieHeader({ movie }: { movie: Movie }) {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-12">
      {/* Player — the projector screen */}
      <div className="relative overflow-hidden rounded-[10px] border border-border bg-black">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[90px]"
          style={{ background: "linear-gradient(to bottom, rgba(242,169,59,0.10), transparent)" }}
          aria-hidden="true"
        />
        <iframe
          className="relative z-0 block aspect-video w-full border-0"
          src={`https://archive.org/embed/${movie.id}`}
          title={`Watch ${movie.title}`}
          allow="fullscreen"
        />
      </div>

      {/* Head — eyebrow → title → meta chips → save */}
      <div className="mt-5">
        <p className="film-slate mb-1.5 text-accent">Now showing</p>
        <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-[2.2rem]">
          {movie.title}
        </h1>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-full border-border bg-card font-mono text-[0.74rem] font-medium uppercase tracking-[0.5px] text-muted-foreground">
            {movie.year}
          </Badge>
          <Badge variant="outline" className="rounded-full border-border bg-card font-mono text-[0.74rem] font-medium uppercase tracking-[0.5px] text-muted-foreground">
            {movie.runtime}
          </Badge>
          <Badge variant="outline" className="rounded-full border-border bg-card font-mono text-[0.74rem] font-medium uppercase tracking-[0.5px] text-muted-foreground">
            {movie.genre}
          </Badge>
          <Badge className="rounded-full border-accent bg-card font-mono text-[0.74rem] font-medium uppercase tracking-[0.5px] text-accent">
            {licenseLabel(movie)}
          </Badge>
        </div>
        <Button
          variant="outline"
          className="mt-4 h-9 rounded-full border-border bg-card px-5 font-mono text-[0.74rem] font-medium uppercase tracking-[0.5px] text-muted-foreground hover:text-accent hover:border-accent/60"
        >
          Save
        </Button>
      </div>
    </div>
  );
}
