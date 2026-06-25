import "./styles.css";

export const metadata = {
  title: "Massive Gap Scanner",
  description: "Scanner de acciones small-cap con corridas recientes.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
