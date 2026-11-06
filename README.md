# Laboratorio de modelación: Montañas rusas

Aplicación web estática para explorar el movimiento de un carrito en una pista diseñada por el estudiante.

## Archivos

- `index.html`: estructura de la aplicación.
- `styles.css`: diseño adaptable a celulares y computadores.
- `app.js`: edición de la trayectoria, simulación y modelo matemático.

## Publicar en GitHub Pages

1. Crea un repositorio público en GitHub, por ejemplo `laboratorio_montana_rusa`.
2. Sube los tres archivos (`index.html`, `styles.css` y `app.js`) a la carpeta principal del repositorio.
3. En el repositorio entra a **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Selecciona la rama `main` y la carpeta `/ (root)`, y guarda.
6. Cuando termine la publicación, GitHub mostrará una dirección similar a `https://TU-USUARIO.github.io/laboratorio_montana_rusa/`.
7. Abre esa dirección desde el celular. Puedes generar un código QR con el enlace para compartirlo.

## Uso

- En **Diseña**, arrastra los puntos de control para modificar la forma de la pista. El primero determina la altura inicial. Puedes agregar o quitar puntos.
- Ajusta la velocidad inicial.
- En **Simula**, inicia, pausa o reinicia el movimiento.
- En **Analiza el modelo**, consulta las gráficas, la tabla y las preguntas de reflexión.

## Modelo físico de esta primera versión

Se considera un carrito que se mueve por una pista fija, sin fricción ni resistencia del aire. La energía mecánica se conserva:

`m*g*h0 + 0.5*m*v0^2 = m*g*h + 0.5*m*v^2`

Por tanto:

`v = sqrt(v0^2 + 2*g*(h0-h))`

La masa se cancela. Si el carrito no tiene energía suficiente para superar una subida, la simulación lo detiene en el punto donde su velocidad llega a cero. Desde el reposo, necesita comenzar con una pendiente descendente para iniciar el movimiento.

La pista se representa como una función suave `h(x)` construida a partir de puntos de control. La simulación integra el tiempo a lo largo de la trayectoria usando la velocidad que predice la conservación de la energía.

## Alcance y simplificaciones

Esta es una primera versión didáctica. No modela rotación de ruedas, fuerza normal, peraltes, resistencia del aire ni fricción. La pista se considera una trayectoria bidimensional y el carrito una partícula. La siguiente versión puede incorporar resistencia/rodadura y comparar el modelo ideal con uno disipativo.
