import "./styles.css";

export const metadata = {
  title: "Momentum Screener | Massive",
  description: "Scanner personal de acciones, momentum, noticias y gráficos con datos de Massive.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
