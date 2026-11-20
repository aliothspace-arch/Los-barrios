export interface ShopOwnerProfile {
  shopId: string;
  ownerName: string;
  title: string;
  baseBravery: number; // 0.15 (timid) .. 0.78 (fearless)
  batStyle: 'wood' | 'aluminum';
  shirtHex: number;
  pantsHex: number;
  skinHex: number;
  hatColor?: number;
  hasShades?: boolean;
  voicePitch: number;
  voiceRate: number;
  dialogues: {
    cjEntry: string[];
    clerkEntry: string[];
    cjIntimidate: string[];
    cjThreaten: string[];
    cjRush: string[];
    clerkScared: string[];
    clerkDefiant: string[];
    clerkComplyOpen: string[];
    cjComplyBag: string[];
    clerkComplyBag: string[];
    clerkRebelDraw: string[];
    cjRebelShock: string[];
    clerkBrawlTaunt: string[];
    cjBrawlHit: string[];
    clerkKo: string[];
    cjLootRegister: string[];
    cjExitComply: string[];
    cjExitFlee: string[];
  };
}

export const SHOP_OWNER_PROFILES: Record<string, ShopOwnerProfile> = {
  shop_247: {
    shopId: 'shop_247',
    ownerName: 'APU RAMÍREZ',
    title: 'ENCARGADO 24/7',
    baseBravery: 0.34,
    batStyle: 'wood',
    shirtHex: 0x9c382a,
    pantsHex: 0x25282e,
    skinHex: 0xb58867,
    voicePitch: 1.08,
    voiceRate: 1.06,
    dialogues: {
      cjEntry: [
        '¡Quietecito, colega! ¡Esto es un atraco, vacía la caja ahora mismo!',
        '¡Arriba las manos! ¡Abre esa registradora o monto un desastre aquí!',
      ],
      clerkEntry: [
        '¡Ey, tranquilo! ¡Acabo de empezar el turno, no hagas ninguna locura!',
        '¡Ay Dios mío, otra vez en Ganton no! ¡Mantén la calma!',
      ],
      cjIntimidate: [
        '¡Muévete o salto el mostrador! ¡Quiero cada billete grande!',
        '¡Deja de mirarme y saca la pasta ya, hermano!',
      ],
      cjThreaten: [
        '¡No me pongas a prueba, te juro que destrozo toda la tienda!',
        '¡O abres esa caja en dos segundos o lo vas a lamentar!',
      ],
      cjRush: [
        '¡Más rápido, que la LSPD no tarda ni un minuto!',
        '¡Acelera esas manos, muévete ya!',
      ],
      clerkScared: [
        '¡Vale, vale! ¡Me tiemblan las manos, no me hagas daño!',
        '¡Te lo doy todo, pero no saltes el mostrador!',
      ],
      clerkDefiant: [
        '¡Estoy harto de los matones de Grove Street robando mi sudor!',
        '¡Mira, esta semana ya me atracaron dos veces y hoy no toca!',
      ],
      clerkComplyOpen: [
        '¡Ya va, ya va! ¡Estoy abriendo el cajón, aquí tienes el dinero!',
      ],
      cjComplyBag: [
        '¡Así me gusta! Pon los fajos en el mostrador, que van a la bolsa.',
        '¡Sigue sacando, no te guardes los billetes de cien!',
      ],
      clerkComplyBag: [
        '¡Toma este fajo! ¡Es todo lo de la tarde, por favor vete ya!',
        '¡Ahí va otro! ¡No queda casi nada en la bandeja!',
      ],
      clerkRebelDraw: [
        '¡Se acabó, idiota! ¡Te vas a llevar un batazo por pasarte de listo!',
      ],
      cjRebelShock: [
        '¡Mierda, tiene un bate! ¡Venga, ven a por mí si te atreves!',
      ],
      clerkBrawlTaunt: [
        '¡Fuera de mi tienda, rata de Ganton!',
        '¡Te voy a partir las costillas con este fresno!',
      ],
      cjBrawlHit: [
        '¡Toma eso! ¡Suelta ese bate, viejo loco!',
        '¡Demasiado lento para Grove Street!',
      ],
      clerkKo: [
        'Ugh... llévate el maldito dinero... me rindo...',
      ],
      cjLootRegister: [
        '¡Debiste cooperar desde el principio! Todo para la bolsa.',
      ],
      cjExitComply: [
        'Gracias por el servicio, amigo. ¡Ni se te ocurra tocar el teléfono!',
      ],
      cjExitFlee: [
        '¡Este tío está majara! ¡Me largo antes de que llegue la pasma!',
      ],
    },
  },
  shop_binco: {
    shopId: 'shop_binco',
    ownerName: 'DANTE MORALES',
    title: 'DUEÑO DE BINCO',
    baseBravery: 0.42,
    batStyle: 'wood',
    shirtHex: 0x296142,
    pantsHex: 0x222428,
    skinHex: 0x8f6246,
    voicePitch: 0.96,
    voiceRate: 1.02,
    dialogues: {
      cjEntry: [
        '¡Nadie se mueva! ¡Binco hoy paga los gastos de Grove Street!',
        '¡Manos donde las vea! ¡Saca todo el efectivo de la caja!',
      ],
      clerkEntry: [
        '¡Oye, relájate! Aquí solo vendemos ropa barata, no hay oro.',
        '¡Ey, cuidado con los percheros! ¿Qué quieres, el dinero?',
      ],
      cjIntimidate: [
        '¡Me importa un bledo tu ropa! ¡Quiero los billetes sobre el mostrador!',
        '¡No te hagas el duro y abre la registradora!',
      ],
      cjThreaten: [
        '¡Te voy a desmontar el local entero si no cooperas ahora!',
        '¡Te quedan tres segundos para abrir esa caja!',
      ],
      cjRush: [
        '¡Date prisa, que no tengo toda la tarde!',
        '¡Rápido, mete cuarta o la liamos!',
      ],
      clerkScared: [
        '¡Está bien, está bien! ¡Solo es dinero asegurado, no me toques!',
        '¡Tranquilo, ahora mismo te saco todos los billetes!',
      ],
      clerkDefiant: [
        '¿Crees que puedes entrar en mi negocio como si nada?',
        '¡Llevo diez años en Ganton, a mí no me asusta nadie!',
      ],
      clerkComplyOpen: [
        '¡Ya pulso el botón! ¡Aquí sale el cajón, tómalo todo!',
      ],
      cjComplyBag: [
        '¡Pasa los fajos aquí arriba! ¡Sin movimientos raros!',
      ],
      clerkComplyBag: [
        '¡Ahí van! ¡Llévate los fajos y déjame en paz!',
      ],
      clerkRebelDraw: [
        '¡Vas a probar el bate que guardo detrás del mostrador, capullo!',
      ],
      cjRebelShock: [
        '¡Eh, suelta ese bate! ¡Si quieres pelea, la tendrás!',
      ],
      clerkBrawlTaunt: [
        '¡Te voy a arreglar la cara gratis!',
        '¡Nadie roba en Binco y sale caminando!',
      ],
      cjBrawlHit: [
        '¡Buen derechazo! ¡A ver si aprendes!',
      ],
      clerkKo: [
        'Agh... maldito seas... la caja está abierta...',
      ],
      cjLootRegister: [
        '¡Buen género y buena caja! Todo adentro.',
      ],
      cjExitComply: [
        'Un placer hacer negocios, Dante. ¡Nos vemos en la calle!',
      ],
      cjExitFlee: [
        '¡Vaya genio tiene el sastre! ¡Hora de pisar el acelerador!',
      ],
    },
  },
  shop_cluckin: {
    shopId: 'shop_cluckin',
    ownerName: 'KEVIN "POLLO" CRUZ',
    title: 'CAJERO CLUCKIN BELL',
    baseBravery: 0.28,
    batStyle: 'wood',
    shirtHex: 0xb5882a,
    pantsHex: 0x2c2a29,
    skinHex: 0xc79e7c,
    hatColor: 0xb5882a,
    voicePitch: 1.14,
    voiceRate: 1.1,
    dialogues: {
      cjEntry: [
        '¡Olvida las alitas! ¡Pon todo el dinero de la caja en el mostrador!',
      ],
      clerkEntry: [
        '¡B-bienvenido a Cluckin Bell! ¡Oh no, por favor no me dispares!',
      ],
      cjIntimidate: [
        '¡Abre esa registradora ahora mismo, colega!',
      ],
      cjThreaten: [
        '¡O sacas los billetes o te meto la cabeza en la freidora!',
      ],
      cjRush: [
        '¡Rápido, rápido! ¡No quiero patatas, quiero billetes!',
      ],
      clerkScared: [
        '¡Solo gano el salario mínimo, te doy hasta las monedas!',
      ],
      clerkDefiant: [
        '¡El gerente me descuenta cada robo del sueldo! ¡Hoy te plantas!',
      ],
      clerkComplyOpen: [
        '¡Ya se abre! ¡Escucha el timbre, aquí está toda la recaudación!',
      ],
      cjComplyBag: [
        '¡Échalos al mostrador! ¡Directo a la bolsa!',
      ],
      clerkComplyBag: [
        '¡Aquí tienes otro fajo! ¡Tómalo y sal corriendo!',
      ],
      clerkRebelDraw: [
        '¡Se acabó ser el pringado del turno noche! ¡Toma bate!',
      ],
      cjRebelShock: [
        '¿El chico del pollo con un bate? ¡Vamos allá!',
      ],
      clerkBrawlTaunt: [
        '¡Esto va por todos los clientes pesados de Los Santos!',
      ],
      cjBrawlHit: [
        '¡Quédate quieto, emplumado!',
      ],
      clerkKo: [
        'Ay... necesito un día libre...',
      ],
      cjLootRegister: [
        '¡Combo familiar en efectivo! Todo a la bolsa.',
      ],
      cjExitComply: [
        '¡Qué buen servicio rápido! ¡Hasta nunca!',
      ],
      cjExitFlee: [
        '¡Este chaval perdió la cabeza! ¡A correr!',
      ],
    },
  },
  shop_ammunation: {
    shopId: 'shop_ammunation',
    ownerName: 'SARGENTO HANK',
    title: 'VETERANO AMMU-NATION',
    baseBravery: 0.72,
    batStyle: 'aluminum',
    shirtHex: 0x3b3e36,
    pantsHex: 0x242622,
    skinHex: 0xc9a384,
    hasShades: true,
    voicePitch: 0.82,
    voiceRate: 0.96,
    dialogues: {
      cjEntry: [
        '¡Quieto, Hank! ¡No toques nada bajo el mostrador y abre la caja!',
      ],
      clerkEntry: [
        '¿Tienes agallas para atracar un Ammu-Nation? Estás loco, chico.',
      ],
      cjIntimidate: [
        '¡No te hagas el héroe, veterano! ¡Saca el dinero ahora!',
      ],
      cjThreaten: [
        '¡Mantén esas manos visibles o acabamos muy mal aquí dentro!',
      ],
      cjRush: [
        '¡Muévete, abre esa caja fuerte antes de que pierda la paciencia!',
      ],
      clerkScared: [
        'Maldición... hoy tengo el cierre atascado. Toma la pasta y lárgate.',
      ],
      clerkDefiant: [
        'He sobrevivido a cosas peores que un pandillero de Ganton.',
      ],
      clerkComplyOpen: [
        'Tienes suerte hoy, chico... aquí tienes la recaudación. No vuelvas.',
      ],
      cjComplyBag: [
        '¡Cada billete encima del mostrador, sin trucos!',
      ],
      clerkComplyBag: [
        'Cuenta bien, porque la próxima vez no saldrás vivo.',
      ],
      clerkRebelDraw: [
        '¡Al diablo con tu atraco! ¡Prueba este aluminio militar en la cabeza!',
      ],
      cjRebelShock: [
        '¡Sabía que Hank iba a saltar! ¡Cuidado con ese bate!',
      ],
      clerkBrawlTaunt: [
        '¡Te voy a enseñar disciplina de la vieja escuela!',
      ],
      cjBrawlHit: [
        '¡Estás oxidado, sargento!',
      ],
      clerkKo: [
        'Ghh... buen golpe, chico... maldita sea...',
      ],
      cjLootRegister: [
        '¡El botín grande de Ammu-Nation es mío!',
      ],
      cjExitComply: [
        'Hasta otra, sargento. ¡Quédate quietecito!',
      ],
      cjExitFlee: [
        '¡Ese viejo pega como un camión! ¡Fuera de aquí!',
      ],
    },
  },
  shop_lscustoms: {
    shopId: 'shop_lscustoms',
    ownerName: 'CHUY MENDOZA',
    title: 'JEFE DE TALLER LSC',
    baseBravery: 0.6,
    batStyle: 'aluminum',
    shirtHex: 0x2c4259,
    pantsHex: 0x1f2226,
    skinHex: 0xa87856,
    hatColor: 0x1e2226,
    voicePitch: 0.88,
    voiceRate: 1.0,
    dialogues: {
      cjEntry: [
        '¡Chuy, suelta la llave inglesa y vacía la caja del taller!',
      ],
      clerkEntry: [
        '¡Ey, compadre! ¿Vienes a tunear o a meterte en un lío serio?',
      ],
      cjIntimidate: [
        '¡Quiero el efectivo de los encargos de hoy, ahora mismo!',
      ],
      cjThreaten: [
        '¡No me obligues a destrozar este garaje, saca el dinero!',
      ],
      cjRush: [
        '¡Abre esa registradora ya, sin rodeos!',
      ],
      clerkScared: [
        '¡Tranquilo, hermano! El dinero no vale una paliza, ya abro.',
      ],
      clerkDefiant: [
        '¡En mi taller nadie se lleva un dólar sin sudar sangre!',
      ],
      clerkComplyOpen: [
        '¡Va, va! Aquí sale el cajón, llévate los billetes y desaparece.',
      ],
      cjComplyBag: [
        '¡Pon los fajos encima, que los meto en la bolsa!',
      ],
      clerkComplyBag: [
        '¡Ahí tienes! ¡Eso es todo lo de la pintura de hoy!',
      ],
      clerkRebelDraw: [
        '¡Ven aquí, ladrón! ¡Te voy a abollar el chasis con mi bate de aluminio!',
      ],
      cjRebelShock: [
        '¡Mierda, el mecánico viene a por todas!',
      ],
      clerkBrawlTaunt: [
        '¡Te voy a dejar peor que un coche siniestro!',
      ],
      cjBrawlHit: [
        '¡Aprende a cubrirte, mecánico!',
      ],
      clerkKo: [
        'Uff... me desconectaste la batería...',
      ],
      cjLootRegister: [
        '¡Presupuesto cobrado! Todo el efectivo a la bolsa.',
      ],
      cjExitComply: [
        '¡Gracias por el ajuste rápido, Chuy!',
      ],
      cjExitFlee: [
        '¡Vaya brazo tiene el mecánico! ¡A la calle!',
      ],
    },
  },
  shop_burgershot: {
    shopId: 'shop_burgershot',
    ownerName: 'RICKY SALAZAR',
    title: 'ENCARGADO BURGER SHOT',
    baseBravery: 0.32,
    batStyle: 'wood',
    shirtHex: 0xb85e25,
    pantsHex: 0x262422,
    skinHex: 0xbd9170,
    hatColor: 0xb85e25,
    voicePitch: 1.1,
    voiceRate: 1.07,
    dialogues: {
      cjEntry: [
        '¡Nada de hamburguesas, quiero la caja abierta ya mismo!',
      ],
      clerkEntry: [
        '¡Eh, calma! ¡Toma lo que quieras pero no saltes aquí!',
      ],
      cjIntimidate: [
        '¡Saca el efectivo y ponlo sobre la barra, colega!',
      ],
      cjThreaten: [
        '¡No me hagas perder los nervios, vacía la caja ahora!',
      ],
      cjRush: [
        '¡Más rápido, que la sirena ya se oye a lo lejos!',
      ],
      clerkScared: [
        '¡Sí, sí, ahora mismo te lo saco todo!',
      ],
      clerkDefiant: [
        '¡Qué fastidio! ¡Estoy harto de los atracadores de Commerce!',
      ],
      clerkComplyOpen: [
        '¡Abierta! ¡Aquí tienes todos los billetes del turno!',
      ],
      cjComplyBag: [
        '¡Sigue pasando fajos! ¡Directos a la bolsa!',
      ],
      clerkComplyBag: [
        '¡Toma, toma! ¡Ya casi no queda nada!',
      ],
      clerkRebelDraw: [
        '¡Hoy te vas a comer un buen batazo doble, imbécil!',
      ],
      cjRebelShock: [
        '¡Uy, que este viene con el bate en alto!',
      ],
      clerkBrawlTaunt: [
        '¡Prueba el menú especial de la casa!',
      ],
      cjBrawlHit: [
        '¡Toma propina!',
      ],
      clerkKo: [
        'Ugh... demasiado picante... me rindo...',
      ],
      cjLootRegister: [
        '¡Todo el efectivo para llevar!',
      ],
      cjExitComply: [
        '¡Buen provecho, Ricky! ¡Adiós!',
      ],
      cjExitFlee: [
        '¡Menudo loco! ¡Me abro de aquí!',
      ],
    },
  },
  shop_suburban: {
    shopId: 'shop_suburban',
    ownerName: 'MARCO VANCE',
    title: 'GERENTE SUB URBAN',
    baseBravery: 0.48,
    batStyle: 'wood',
    shirtHex: 0x264d38,
    pantsHex: 0x1e2024,
    skinHex: 0xd1aa8a,
    voicePitch: 0.94,
    voiceRate: 1.01,
    dialogues: {
      cjEntry: [
        '¡Esto es un atraco, Vinewood! ¡Vacía esa registradora ya!',
      ],
      clerkEntry: [
        '¿Aquí en Vinewood Boulevard? ¡Por favor, mantén la calma!',
      ],
      cjIntimidate: [
        '¡Menos charla pija y más billetes sobre el mostrador!',
      ],
      cjThreaten: [
        '¡Abre esa caja o arraso toda la boutique ahora mismo!',
      ],
      cjRush: [
        '¡Rápido, que no quiero esperar a tu seguridad privada!',
      ],
      clerkScared: [
        '¡De acuerdo, no rompas nada! ¡Te entrego la caja entera!',
      ],
      clerkDefiant: [
        '¡Pagué demasiado por esta boutique para dejármela robar!',
      ],
      clerkComplyOpen: [
        '¡Ya está abierta! ¡Toma el efectivo y sal por esa puerta!',
      ],
      cjComplyBag: [
        '¡Pon los billetes ahí delante, directo a mi bolsa!',
      ],
      clerkComplyBag: [
        '¡Aquí va otro fajo! ¡Por favor, márchate!',
      ],
      clerkRebelDraw: [
        '¡No vas a arruinar mi tienda! ¡Prepárate para este bate!',
      ],
      cjRebelShock: [
        '¡El niño bien tiene un bate! ¡Ven aquí!',
      ],
      clerkBrawlTaunt: [
        '¡Te voy a sacar a golpes de Vinewood!',
      ],
      cjBrawlHit: [
        '¡A ver si eso te quita los humos!',
      ],
      clerkKo: [
        'Agh... mi traje... llévate el dinero...',
      ],
      cjLootRegister: [
        '¡Billetes de Vinewood directos a la bolsa!',
      ],
      cjExitComply: [
        '¡Bonita tienda, Marco! ¡Volveré nunca!',
      ],
      cjExitFlee: [
        '¡Largo de aquí antes de que cierre la avenida la LSPD!',
      ],
    },
  },
};

export const SHOP_AMBIENT_GREETINGS: Record<string, string[]> = {
  shop_247: [
    '¡Buenas! Pasa, tenemos bebidas frías y botiquines al fondo.',
    '¡Bienvenido al 24/7! Si necesitas algo, acércate a la caja.',
  ],
  shop_binco: [
    '¡Ey! Échale un ojo a la nueva colección de Grove Street.',
    '¡Pasa adelante! Aquí tenemos la ropa al mejor precio del barrio.',
  ],
  shop_cluckin: [
    '¡Alitas recién hechas y tacos crujientes! ¿Qué te pongo hoy?',
    '¡Huele a gloria en este carrito! Acércate a pedir cuando quieras.',
  ],
  shop_ammunation: [
    'Entra, chico. Aquí vendemos protección seria, nada de juguetes.',
    'Bienvenido a Ammu-Nation. Mantén las manos a la vista cerca del mostrador.',
  ],
  shop_lscustoms: [
    '¡Qué pasa, jefe! Trae el coche o acércate al mostrador si necesitas piezas.',
    'Taller abierto todo el día. Reparación, nitro y pintura al instante.',
  ],
  shop_burgershot: [
    '¡Bienvenido a Burger Shot! Menús recién salidos de la plancha.',
    '¡Pasa! Pide en la caja cuando quieras algo caliente.',
  ],
  shop_suburban: [
    'Bienvenido a Sub Urban Vinewood. Acércate a la caja si buscas estilo.',
    'Buenas tardes. Tenemos trajes ejecutivos recién llegados.',
  ],
};

export function getShopAmbientGreeting(shopId: string, index = 0): string {
  const pool = SHOP_AMBIENT_GREETINGS[shopId] ?? SHOP_AMBIENT_GREETINGS.shop_247;
  return pool[Math.abs(index) % pool.length];
}

export function getShopOwnerProfile(shopId: string): ShopOwnerProfile {
  return SHOP_OWNER_PROFILES[shopId] ?? SHOP_OWNER_PROFILES.shop_247;
}

