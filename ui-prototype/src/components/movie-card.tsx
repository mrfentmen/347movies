import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Bookmark } from "lucide-react";
import type { Movie } from "@/data/movies";

export function MovieCard({ movie, onSave }: { movie: Movie; onSave: (id: string) => void }) {
  return (
    <Card className="group relative overflow-hidden rounded-[10px] border-border bg-card transition-all duration-200 hover:-translate-y-[3px] hover:border-accent/70 hover:shadow-[0_6px_22px_rgba(0,0,0,0.35),0_0_0_1px_rgba(242,169,59,0.08)]">
      <a href={`#/movie/${movie.id}`} className="block">
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary">
          <img
            src={movie.thumb}
            alt={`Poster for ${movie.title}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition-transform duration-200 group-hover:scale-[1.02]"
          />
        </div>
        <CardContent className="flex flex-col gap-1 p-3">
          <span className="film-slate text-muted-foreground">{movie.year}</span>
          <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {movie.title}
          </span>
          <span className="text-xs text-muted-foreground">{movie.genre}</span>
        </CardContent>
      </a>
      <button
        type="button"
        onClick={() => onSave(movie.id)}
        aria-pressed="false"
        className={cn(
          "flex w-full items-center justify-center gap-2 border-t border-border bg-secondary py-2.5",
          "film-slate text-muted-foreground transition-colors hover:text-accent hover:border-accent/60",
        )}
      >
        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
        Save
      </button>
    </Card>
  );
}
