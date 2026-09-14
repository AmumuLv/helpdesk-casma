import random

from app.models.enums import TicketCategory as C

_PHRASES: dict[C, list[str]] = {
    C.HARDWARE: [
        "la computadora no prende", "no enciende el cpu", "el equipo se apaga solo", "se reinicia a cada rato",
        "el cpu hace un ruido fuerte", "sale olor a quemado de la pc", "pantalla negra al prender",
        "la pc pita al encender", "la laptop no carga la bateria", "el ventilador suena demasiado",
        "la computadora se calienta mucho", "sale pantallazo azul", "no reconoce el disco duro",
        "el boton de encendido no funciona", "salio humo del estabilizador", "se fue la luz y ya no prende la pc",
        "la fuente de poder esta malograda", "la memoria ram fallo", "el monitor no da imagen", "la laptop se cayo y no prende",
    ],
    C.RED_INTERNET: [
        "no hay internet", "no tengo conexion", "sin red en la oficina", "el internet esta muy lento",
        "no carga ninguna pagina", "no puedo acceder a la red compartida", "se cae el internet a cada rato",
        "el wifi no conecta", "el cable de red esta suelto", "aparece red no identificada",
        "no llega internet a toda la oficina", "no entra a la carpeta compartida del servidor",
        "el switch tiene las luces apagadas", "sin conexion a internet desde la mañana",
        "el icono de red sale con signo de admiracion", "no hay señal de wifi en el piso",
    ],
    C.IMPRESORA: [
        "la impresora no imprime", "atasco de papel", "la impresora no jala el papel", "la hoja sale manchada",
        "se acabo el toner", "cambiar cartucho de tinta", "la impresora no aparece en la computadora",
        "imprime borroso", "sale error impresora desconectada", "la fotocopiadora no escanea",
        "la impresora hace ruido y no avanza", "los documentos en cola de impresion no salen",
        "necesito instalar la impresora", "la multifuncional muestra un error", "imprime hojas en blanco",
    ],
    C.SOFTWARE: [
        "la computadora esta muy lenta", "se congela todo", "el word no abre", "el excel se cierra solo",
        "necesito instalar un programa", "la actualizacion de windows no termina", "no abre el navegador",
        "se colgo la pc", "office pide activacion", "error al abrir archivo pdf", "necesito instalar adobe reader",
        "el programa no responde", "la pc tarda mucho en arrancar", "no puedo abrir los archivos de excel",
        "se borro un archivo importante", "windows muestra un error al iniciar",
    ],
    C.SISTEMAS_MUNICIPALES: [
        "no puedo entrar al siaf", "error en el siga", "el sistema de tramite documentario no carga",
        "no abre el sistema de rentas", "el sistema de caja no permite cobrar",
        "no puedo registrar expediente en mesa de partes", "el sisgedo no funciona",
        "error en el sistema de licencias de funcionamiento", "no carga el modulo de tesoreria",
        "el sistema de planillas da error", "no puedo emitir recibos en caja", "el sistema de catastro esta lento",
        "la consulta reniec no responde", "el sistema de logistica esta bloqueado",
        "no se genera la orden de servicio en el siga", "el sistema de registro civil no guarda",
    ],
    C.CUENTAS_CORREO: [
        "olvide mi contraseña del correo", "no puedo entrar a mi correo institucional", "mi cuenta esta bloqueada",
        "crear usuario nuevo para personal", "cambiar contraseña de windows", "no me llegan los correos",
        "el correo dice buzon lleno", "necesito acceso a una carpeta", "el usuario de windows esta bloqueado",
        "restablecer mi clave del sistema", "dar de baja el usuario de un trabajador que se fue",
        "no puedo enviar correos con adjuntos", "outlook pide contraseña a cada rato",
    ],
    C.SEGURIDAD: [
        "creo que la computadora tiene virus", "salen ventanas de publicidad", "los archivos cambiaron de extension",
        "aparece un mensaje pidiendo rescate", "me llego un correo sospechoso", "hice clic en un enlace raro",
        "el antivirus esta desactivado", "la usb tiene virus", "alguien entro a mi cuenta",
        "los archivos estan encriptados y no abren", "una pagina falsa me pidio mi contraseña", "la pc hace cosas sola",
    ],
    C.PERIFERICOS: [
        "el mouse no funciona", "el teclado no escribe", "algunas teclas no funcionan", "no reconoce la memoria usb",
        "el escaner no funciona", "los parlantes no suenan", "la camara web no se ve", "el lector de codigo de barras no lee",
        "necesito un mouse nuevo", "el microfono no funciona en las reuniones", "el segundo monitor no detecta",
        "el cable hdmi esta malogrado", "el mouse se mueve solo",
    ],
    C.OTRO: [
        "consulta sobre un equipo nuevo", "necesito apoyo para una presentacion", "mover la computadora a otro escritorio",
        "instalar proyector para reunion", "solicito asesoria tecnica", "necesito un cable de extension",
        "revision general del equipo", "capacitacion en uso de la computadora", "ayuda con el televisor de la sala",
        "conectar la laptop al proyector",
    ],
}

_PREFIXES = ["", "", "buenos dias ", "ayuda por favor ", "señor tecnico ", "desde ayer ", "hola "]
_SUFFIXES = ["", "", " por favor", " desde la mañana", " ya reinicie y sigue igual", " necesito ayuda", " no puedo trabajar"]


def seed_samples(variants: int = 5, rng_seed: int = 2026) -> tuple[list[str], list[str]]:
    rng = random.Random(rng_seed)
    texts, labels = [], []
    for category, phrases in _PHRASES.items():
        for phrase in phrases:
            combos = {(p, s) for p in _PREFIXES for s in _SUFFIXES}
            for prefix, suffix in rng.sample(sorted(combos), k=min(variants, len(combos))):
                texts.append(f"{prefix}{phrase}{suffix}".strip())
                labels.append(category.value)
    return texts, labels
