# Short Squeeze | alcance de la primera versión

Pantalla separada de investigación para acciones de EE. UU. No genera ni transmite órdenes, no modifica las corridas del escáner principal y no confirma que haya ocurrido un *short squeeze*.

## Qué se mide

- **D1:** variación del cierre con respecto al cierre ajustado de la sesión anterior. Rango típico de la estrategia: 20 % a 100 %. El máximo de D1 se conserva aparte como referencia, no como entrada automática. Se excluyen gaps de apertura superiores a +100 % aunque el cierre se devuelva (límite operativo inicial). El umbral del volumen relativo es provisional y editable: por defecto 3× la mediana de las 20 sesiones anteriores, sin el volumen del propio D1.
- **D2:** se informa cuánto de la ganancia se conserva tanto al mínimo como al cierre; por defecto exige que el mínimo conserve al menos el 50 %. Se puede ensayar el modo cierre sin confundirlo con el criterio conservador. D2 debe ser la siguiente sesión de mercado, no una sesión posterior escogida porque tenga datos.
- **Puertas obligatorias:** el usuario confirma que el flotante es bajo, y verifica una noticia de la empresa o del sector y disponibilidad ETB con su broker en D1 y D2. «No verificado» no equivale a «Sí». La disponibilidad es un dato operativo y no prueba que existan posiciones cortas abiertas.
- **Flotante:** no se confunde con las acciones en circulación. El número de acciones en circulación inferior a 40 millones es una preferencia de la estrategia, no una condición obligatoria inventada. La observación de flotante de Massive es la última medición disponible; no se usa una medición posterior a un D1 histórico como si fuera contemporánea.

## D3+: observación manual, fuera del detector diario

Leer el gráfico de 1 min o 5 min, Level 2 y Time & Sales del broker. Comparar rupturas de rango, bandera alcista o ataque al máximo de D1. Las reglas de tamaño y salida de la estrategia se reservan para un replay separado: entrada directa a menos del 1 % sobre el máximo de D1; ¼ a ½ dentro de una consolidación, posibilidad de completar al romper; stop en la base inmediata del patrón, o mínimo pertinente en la ruptura de apertura, con referencias de 5–10 centavos y relaciones beneficio/riesgo de 5:1–10:1. El detector no simula ejecuciones, piramidación, stops ni parciales. Un replay futuro no deberá inferir el orden de toque de entrada y stop solo de barras OHLC.

## Límites del proveedor

- [Massive Stocks Basic: disponibilidad de barras](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data): las barras del día anterior llegan después de medianoche de Nueva York, no al cierre.
- [Massive: historial de flotante](https://massive.com/knowledge-base/article/does-massive-have-historical-float-data): sólo la última medición por ticker, con fecha efectiva.
- [Massive: Level 2](https://massive.com/knowledge-base/article/does-massive-offer-level-2-data): publica NBBO y operaciones individuales, no el libro de órdenes ni su profundidad.
