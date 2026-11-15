#!/usr/bin/env python3
"""Store the Massive key locally without echoing it or accepting CLI secrets."""

import getpass
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings


def save_key(key, target):
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,256}", key):
        raise ValueError("Formato inválido. Pega únicamente la API key de Massive.")
    if target.is_symlink():
        raise ValueError("No se modifica .env.local porque es un enlace simbólico.")
    content = target.read_text() if target.exists() else ""
    lines = content.splitlines()
    lines = [line for line in lines if not re.match(r"^\s*(?:export\s+)?MASSIVE_API_KEY\s*=", line)]
    lines.append("MASSIVE_API_KEY=" + key)
    handle, temporary = tempfile.mkstemp(prefix=".massive-key-", dir=target.parent)
    try:
        os.fchmod(handle, 0o600)
        with os.fdopen(handle, "w") as output:
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if len(sys.argv) != 1:
        print("Ejecuta este script sin argumentos. La clave se pide de forma oculta.", file=sys.stderr)
        return 1
    print("Configurar Massive para el scanner local.")
    print("Pega la clave en el siguiente campo oculto y pulsa Enter.")
    print("No se muestra, no se envía al chat y no se valida contra servicios externos.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            key = getpass.getpass("API key de Massive (oculta): ").strip()
        save_key(key, Path(__file__).resolve().parent.parent / ".env.local")
    except (EOFError, KeyboardInterrupt):
        print("\nCancelado. No se guardó ninguna clave.")
        return 1
    except getpass.GetPassWarning:
        print("Abre Terminal y ejecuta allí este script para ocultar la clave.", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        # No exceptions from network requests or secret-bearing input are printed.
        print(str(error) if isinstance(error, ValueError) else "No se pudo guardar la clave localmente.", file=sys.stderr)
        return 1
    finally:
        key = None
    print("Clave guardada con permisos privados en .env.local. Reinicia el servidor local si estaba abierto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
