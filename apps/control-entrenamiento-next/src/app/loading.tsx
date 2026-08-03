export default function Cargando() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando">
      <div className="h-8 w-2/3 animate-pulse rounded-tarjeta bg-borde" />
      <div className="h-24 animate-pulse rounded-tarjeta bg-borde" />
      <div className="h-24 animate-pulse rounded-tarjeta bg-borde" />
    </div>
  );
}
