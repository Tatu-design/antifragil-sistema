import Link from "next/link";

export default function NoEncontrado() {
  return (
    <div className="page sin-barra">
      <h1>Eso no existe</h1>
      <p className="subtitulo">
        La página o el cliente que buscas no está aquí.
      </p>
      <Link className="boton" href="/clientes">
        Volver a clientes
      </Link>
    </div>
  );
}
