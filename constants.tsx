
import { Question } from './types';

export const QUESTIONS: Question[] = [
  {
    id: "1",
    scenario: "Después de un malentendido con alguien, ¿qué sucede en tu mente al llegar a casa?",
    options: [
      { key: "a", text: "Pienso en soluciones prácticas para arreglarlo a la mañana siguiente, no es algo que ocupa mi mente todo el día." },
      { key: "b", text: "Suelo reconstruir la escena una y otra vez, analizando cada palabra que dije y lo que la otra persona pudo haber interpretado. No puedo dejar de pensar en cómo “metí la pata”." },
      { key: "c", text: "Siento un peso en el pecho y la certeza de que, haga lo que haga, siempre Acabo engañando a los demás. Esta es una historia que se repite." }
    ]
  },
  {
    id: "1.1",
    scenario: "Ese pensamiento tras el malentendido. ¿Cuánto tiempo persiste en tu cabeza?",
    options: [
      { key: "a", text: "Pienso en ello unos minutos y luego se va." },
      { key: "b", text: "Estoy pensando en eso varias horas, incluso mientras realizo otras tareas." },
      { key: "c", text: "No soy capaz de soltarlo ese pensamiento en todo el día." }
    ]
  },
  {
    id: "2",
    scenario: "Al visualizar la semana que tienes por delante, ¿cuál es el sentimiento predominante?",
    options: [
      { key: "a", text: "Me agobio por el volumen de tareas y la logística, siento que las horas del día no me van a alcanzar a todo." },
      { key: "b", text: "Tengo miedo a no saber gestionar la carga laboral o familiar que me espera por delante y eso ne llevar a cometer algún fallo." },
      { key: "c", text: "Me pregunto para qué sirve todo este esfuerzo si me siento vací@ por dentro, como si estuviera desconectad@ de mi mism@" }
    ]
  },
  {
    id: "2.2",
    scenario: "Ese sentimiento de agobio, miedo o vacío al visualizar la semana que tienes por delante. ¿Con qué frecuencia lo sientes?",
    options: [
      { key: "a", text: "Me siento así, el día festivo antes de incorporarme a la rutina de la semana." },
      { key: "b", text: "Suelo sentirme así 3 o 4 veces durante la semana." },
      { key: "c", text: "Es mi estado constante cada mañana" }
    ]
  },
  {
    id: "3",
    scenario: "Cuando finalmente tienes un momento de silencio absoluto ¿que ocurre en tu interior?",
    options: [
      { key: "a", text: "Me cuesta relajarme porque mi mente sigue haciendo listas de tareas pendientes, pero acabo encontrando un poco de paz." },
      { key: "b", text: "El silencio me aterra porque es cuando los bucles mentales sobre el pasado y el futuro suenan más fuertes. Necesito distracciones (móvil, tele, etc…)." },
      { key: "c", text: "Siento un vacío profundo o una angustia que no se de donde viene. Es una sensación de “estar perdido@ en la niebla”." }
    ]
  },
  {
    id: "3.3",
    scenario: "¿Que compromiso tienes contigo mis@ para que estos momentos de silencio dejen de ser una carga y se conviertan en pasado?",
    isScale: true,
    scaleLabel: "Escala del 1-10",
    options: Array.from({ length: 10 }, (_, i) => ({ key: String(i + 1), text: String(i + 1) }))
  },
  {
    id: "4",
    scenario: "Escribes a alguien que te importa y pasan las horas y no tienes respuesta ¿Que historia te cuenta tu mente mientras esperas?",
    options: [
      { key: "a", text: "Pienso que seguramente está con mucho trabajo o sin batería; Me fastidia no poder comunicarme con esta persona, pero sigo con lo que estaba haciendo." },
      { key: "b", text: "Repaso mi último mensaje, buscando si dije algo inadecuado. Siento una inquietud que me obliga a mirar el móvil cada pocos minutos." },
      { key: "c", text: "Aparece una sensación de “agujero” en el estómago. Siento que, al final, siempre acabo sobrando o que no soy una prioridad para nadie." }
    ]
  },
  {
    id: "4.4",
    scenario: "¿Este sentimiento, al no poder comunicarte con la persona que te importa, ¿desaparece cuando recibes la respuesta?, o incluso habiendo tenido respuesta en un tiempo más largo del esperado, ¿sigues dando vueltas durante todo el día?",
    options: [
      { key: "a", text: "No, en realidad desaparece en el momento que me contestan." },
      { key: "b", text: "Sí, además me cuestiono si tardó en responderme por un motivo justificado o no lo hizo deliberadamente." }
    ]
  },
  {
    id: "5",
    scenario: "Te enteras de que tu grupo de amigos han convocado una reunión para juntarse y aún no te han dicho nada…",
    options: [
      { key: "a", text: "Espero que me digan algo a mi también, seguramente nos iremos avisando un@sa otr@sy todavía no ha dado tiempo a que me lo comente a mi." },
      { key: "b", text: "Pienso que mis amig@ se han olvidado de decirme algo ya que a veces me siento invisible y estos actos me lo confirman." },
      { key: "c", text: "Me invade una sensación de no pertenecer al grupo y no importarle a absolutamente nadie, me cuestiono que seguramente ya han quedado más veces y no me han avisado." }
    ]
  },
  {
    id: "6",
    scenario: "Tienes una discusión con tu pareja, en el trabajo, o con alguien muy cercano... ¿Qué sentimientos afloran en ti?",
    options: [
      { key: "a", text: "Siento tensión y enfado en el momento, pero una vez que hablamos y se aclara el problema externo, suelo calmarse y recuperar mi centro." },
      { key: "b", text: "La rabia me desborda y me quedo rumiando el conflicto durante días, reviviendo la conversación y pensando en lo que debí decidir." },
      { key: "c", text: "Siento que el conflicto es una prueba de que siempre me pasa lo mismo en mis relaciones, no puedo controlar la rabia, ni se como sacarla de mi mente, me convierto en una persona con pensamientos negativos." }
    ]
  },
  {
    id: "7",
    scenario: "¿Cuándo fue la última vez que te miraste al espejo y te gustó lo que veías?",
    options: [
      { key: "a", text: "Cuando me miro en el espejo aún me gusta lo que veo." },
      { key: "b", text: "Hace poco, me sentí bien con migo mism@ al mirarme en el espejo." },
      { key: "c", text: "Puede que un tiempo, hace meses que prefiero no mirar." },
      { key: "d", text: "Hace mucho tiempo que no me gusta lo que veo en el espejo." },
      { key: "e", text: "Jamás me gustó lo que veía al mirarme en el espejo." }
    ]
  },
  {
    id: "8",
    scenario: "¿Cuándo fue la última vez que te levantaste por la mañana con alegría y el entusiasmo de comerte el mundo?",
    options: [
      { key: "a", text: "Hasta hace poco lo hacia." },
      { key: "b", text: "Alguna vez me levantó así no hace demasiado." },
      { key: "c", text: "Ya hace algún tiempo que no he tenido esa sensación de comerme el mundo." },
      { key: "d", text: "Hace mucho tiempo que no me levanto con esa energía." },
      { key: "e", text: "Nunca he tenido esa sensación." }
    ]
  },
  {
    id: "9",
    scenario: "¿Cuándo fue la última vez que dejaste de hacer lo que realmente te gusta?",
    options: [
      { key: "a", text: "Lo cierto es, que aún intento hacer cosas que me gusten." },
      { key: "b", text: "Hasta hace relativamente poco intentaba hacer lo que me gustaba." },
      { key: "c", text: "Antes pensaba en hacerlas, pero hace tiempo que lo que hago es por obligación." },
      { key: "d", text: "Hace mucho que ni pienso en lo que me gusta, solo me dejo llevar." },
      { key: "e", text: "Creo que nunca he sabido pensar en mí antes que en mis obligaciones o los demás." }
    ]
  },
  {
    id: "10",
    scenario: "¿Cuándo fue la última vez que disfrutaste de lo que tienes, pues eres una persona completa que vive el presente y es dueñ@ de tu propia existencia?",
    options: [
      { key: "a", text: "Intente cada día ser consciente de lo que tengo y disfrutarlo." },
      { key: "b", text: "En ocasiones me siento bien y presente y otras veces ni disfruto lo que tengo y no tengo muy claro quién soy o dónde voy." },
      { key: "c", text: "Antes me sentía yo mim@ , valoraba lo que tenía mucho más que ahora y no necesitaba mucho más. Pero hace un tiempo que no me siento así." },
      { key: "d", text: "Hace mucho tiempo que no disfruto de quien soy ni de lo que he podido conseguir hasta ahora." },
      { key: "e", text: "Nunca he podido disfrutar de lo que tengo, siempre he tenido que pelear por conseguirlo todo, luchando a contra corriente." }
    ]
  },
  {
    id: "11",
    scenario: "¿Cuándo fue la última vez que pudiste dormir una noche seguida, sin dejar que las preocupaciones te invadan?",
    options: [
      { key: "a", text: "Por suerte aún puedo dormir normalmente." },
      { key: "b", text: "De tanto en tanto me cuesta dormir ya veces me despierto pensando situaciones y me cuesta volver a tomar el sueño." },
      { key: "c", text: "La mayoría de las noches me cuesta conciliar el sueño por culpa de mis pensamientos y siento que no descanso bien porque el suelo se desvelarme." },
      { key: "d", text: "Llevo tiempo con problemas para conciliar el sueño correctamente, duermo poco y mal." },
      { key: "e", text: "Temo la hora de irme a dormir, es cuando más fuerte suenan pensamientos y recuerdos y no me dejar descansar pensando en, y si… o, debería haber hecho o dicho… Llevo mucho así." }
    ]
  },
  {
    id: "12",
    scenario: "¿Cuándo fue la última vez que pudiste respirar con calma y paz, ante las situaciones incómodas de la vida?, sin entrar en pánico o dejar que la ansiedad te invada.",
    options: [
      { key: "a", text: "Rara vez pierdo la calma, suelo tomarme las cosas con filosofía." },
      { key: "b", text: "Alguna vez ya no puedo con según que situaciones y siento algo de pánico hasta que salgo del paso." },
      { key: "c", text: "Es normal en ocasiones perder la calma en según que situaciones, y ¿a quien no le ha dado un pequeño ataque de ansiedad de tanto en tanto? Con la vida que llevamos todos….." },
      { key: "d", text: "Por algún motivo sin saber muy bien porqué, siento... como ansiedad en situaciones complejas y prefiero evitarlas aunque me persigan." },
      { key: "e", text: "Me cuesta mucho mantener la calma, me afectan las cosas demasiado y hasta me cuesta respirar a veces." },
      { key: "f", text: "Hace mucho tiempo que no respiro calma y paz, suelo saltar enseguida por cualquier cosa, ya estoy a tope." },
      { key: "g", text: "Tengo ataques de ansiedad y por eso prefiero aislarme para evitar las situaciones incómodas de la vida. Creo que ya no puedo soportarlo." }
    ]
  }
];
