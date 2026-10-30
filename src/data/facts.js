// Short historical facts shown on loading screens (Spanish).

export const FACTS = [
  'El Saturn V medía 110,6 metros: más alto que la Estatua de la Libertad con su pedestal.',
  'En el despegue el Saturn V pesaba unas 2.900 toneladas; cerca del 85 % era propelente.',
  'Los cinco motores F-1 de la primera etapa quemaban casi 13 toneladas de propelente por segundo.',
  'La primera etapa funcionó apenas 2 minutos y 41 segundos y dejó al cohete a unos 67 km de altura.',
  'El ordenador de guiado del Apolo tenía 2.048 palabras de memoria borrable y su reloj iba a unos 2 MHz.',
  'El software del ordenador de guiado se "tejía" a mano: la memoria de núcleos trenzados la cosían operarias de Raytheon.',
  'Durante el alunizaje del Apolo 11 saltaron alarmas 1202 y 1201. Steve Bales, de 26 años, respondió: «GO».',
  'Cuando el Eagle tocó la Luna, Houston acababa de cantar «30 segundos» de combustible restante.',
  'El Eagle alunizó unos 6 km más allá del punto previsto: Armstrong sobrevoló el cráter West y su campo de rocas.',
  'Michael Collins pasó unas 21 horas solo en órbita lunar mientras Armstrong y Aldrin estaban en la superficie.',
  'Los tonos Quindar (2.525 y 2.475 Hz) encendían y apagaban los transmisores remotos de la red de la NASA.',
  'El tanque de oxígeno 2 del Apolo 13 explotó a las 55 h 54 min de misión, a más de 320.000 km de la Tierra.',
  'La tripulación del Apolo 13 usó el módulo lunar Aquarius como bote salvavidas durante casi cuatro días.',
  'Para limpiar el CO₂ del Apolo 13, los ingenieros diseñaron un adaptador con bolsas, cartón, cinta adhesiva y una manguera.',
  'El Apolo 12 fue alcanzado por dos rayos durante el ascenso. «SCE a AUX» salvó la misión.',
  'Con su mochila PLSS, el traje A7L pesaba unos 90 kg en la Tierra… y apenas 15 kg en la Luna.',
  'La cápsula reingresaba a unos 11 km/s y su escudo térmico soportaba cerca de 2.700 °C.',
  'Durante la reentrada, el plasma que rodeaba la cápsula cortaba la radio durante unos tres o cuatro minutos.',
  'Los paracaídas principales del módulo de mando medían 25,4 metros de diámetro.',
  'La foto «Earthrise» la tomó Bill Anders desde el Apolo 8 el 24 de diciembre de 1968.',
  'El módulo lunar no tenía asientos: los astronautas pilotaban de pie, sujetos con arneses.',
  'En algunos puntos, la piel del módulo lunar era tan delgada como unas pocas hojas de papel de aluminio.',
  'El transportador de orugas llevaba al Saturn V hasta la plataforma a 1,6 km/h: el viaje duraba unas seis horas.',
  'El motor de ascenso del módulo lunar no tenía repuesto: tenía que encenderse a la primera para volver a casa.',
  'Unas 400.000 personas trabajaron en el programa Apolo.',
  'El Saturn V nunca perdió una carga útil: voló 13 veces entre 1967 y 1973.',
  'Las ventanas del módulo de mando eran de vidrio de sílice y aluminosilicato: tres paneles para resistir la reentrada.',
  'Desde la Luna, la Tierra no sale ni se pone: queda casi fija en el cielo del lugar de alunizaje.',
];

export function randomFacts(n = FACTS.length) {
  const a = FACTS.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
