import Link from "next/link";

export default function NoEncontrado() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-xl font-semibold">Eso no existe</h1>
      <p className="text-sm text-tinta-suave">
        El cliente o la página que buscas no está aquí. Puede que se haya borrado.
      </p>
      <Link href="/clientes" className="boton-suave max-w-xs">
        Volver a clientes
      </Link>
    </main>
  );
}
