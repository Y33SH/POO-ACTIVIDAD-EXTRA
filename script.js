const DATABASE_KEY = 'uanl_transporte_db';

function crearViajesDeEjemplo() {
    return [
        ['Camión', 1000, '2026-10-18T08:35:00', 'URB-261018-0842'],
        ['Camión', 1000, '2026-10-17T18:12:00', 'URB-261017-1936'],
        ['Camión', 1000, '2026-10-17T07:48:00', 'URB-261017-0721'],
        ['Camión', 1000, '2026-10-16T17:56:00', 'URB-261016-1854']
    ].map(([service, amount, createdAt, id]) => ({
        id,
        type: 'pasaje',
        service,
        amount,
        createdAt: new Date(createdAt).toISOString(),
        example: true
    }));
}

class CuentaTransporte {
    #celular;

    constructor(celular) {
        this.#celular = celular;
    }

    get celular() {
        return this.#celular;
    }

    autenticar(pin) {
        return /^\d{4}$/.test(pin);
    }
}

class CuentaEstudianteUANL extends CuentaTransporte {
    autenticar(pin) {
        if (!super.autenticar(pin)) {
            throw new Error('Ingresa un PIN de exactamente 4 dígitos.');
        }

        let database;
        try {
            database = JSON.parse(localStorage.getItem(DATABASE_KEY));
        } catch {
            database = null;
        }

        if (!database || database.account?.phone !== this.celular) {
            database = {
                account: { phone: this.celular, authenticated: true },
                balance: 30000,
                movements: crearViajesDeEjemplo()
            };
        } else {
            database.account.authenticated = true;
        }

        localStorage.setItem(DATABASE_KEY, JSON.stringify(database));
        return true;
    }
}

class ControladorInterfaz {
    constructor() {
        this.cuentaActual = null;
        this.step1 = document.getElementById('step-1');
        this.step2 = document.getElementById('step-2');
        this.celularInput = document.getElementById('celular');
        this.politicasCheckbox = document.getElementById('politicas');
        this.pinInput = document.getElementById('pin');
        this.mensajeRegistro = document.getElementById('mensaje-registro');
        this.mensajePin = document.getElementById('mensaje-pin');
        this.enlazarEventos();
    }

    enlazarEventos() {
        document.getElementById('form-cuenta').addEventListener('submit', (event) => {
            event.preventDefault();
            const celular = this.celularInput.value.replace(/\D/g, '');
            if (celular.length !== 10) {
                this.mensajeRegistro.textContent = 'Escribe un número celular de 10 dígitos.';
                return;
            }
            if (!this.politicasCheckbox.checked) {
                this.mensajeRegistro.textContent = 'Acepta los términos para continuar.';
                return;
            }

            this.cuentaActual = new CuentaEstudianteUANL(celular);
            this.mensajeRegistro.textContent = '';
            this.pinInput.value = '';
            this.cambiarVista(this.step1, this.step2);
        });

        this.politicasCheckbox.addEventListener('change', () => {
            document.getElementById('btn-enviar-codigo').disabled = !this.politicasCheckbox.checked;
        });

        document.getElementById('btn-mostrar-pin').addEventListener('click', (event) => {
            const visible = this.pinInput.type === 'password';
            this.pinInput.type = visible ? 'text' : 'password';
            event.currentTarget.innerHTML = `${visible ? 'Ocultar' : 'Mostrar'} PIN <span aria-hidden="true">◉</span>`;
        });

        document.getElementById('btn-iniciar-sesion').addEventListener('click', () => this.iniciarSesion());
        this.pinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') this.iniciarSesion();
        });

        document.getElementById('btn-olvido-pin').addEventListener('click', () => {
            this.mensajePin.textContent = 'Para esta demostración, usa cualquier PIN de 4 dígitos.';
            this.mensajePin.style.color = 'var(--muted)';
        });
        document.getElementById('btn-biometria').addEventListener('click', () => {
            this.mensajePin.textContent = 'El acceso biométrico no está disponible en esta simulación.';
            this.mensajePin.style.color = 'var(--muted)';
        });

        ['btn-regresar', 'btn-cancelar', 'btn-cancelar-footer'].forEach((id) => {
            document.getElementById(id).addEventListener('click', () => {
                this.mensajePin.textContent = '';
                this.cambiarVista(this.step2, this.step1);
            });
        });
    }

    iniciarSesion() {
        try {
            if (!this.cuentaActual) throw new Error('Vuelve a ingresar tu número celular.');
            this.cuentaActual.autenticar(this.pinInput.value);
            window.location.href = 'boletos.html';
        } catch (error) {
            this.mensajePin.textContent = error.message;
            this.mensajePin.style.color = '#b42318';
        }
    }

    cambiarVista(vistaOcultar, vistaMostrar) {
        vistaOcultar.hidden = true;
        vistaMostrar.hidden = false;
    }
}

document.addEventListener('DOMContentLoaded', () => new ControladorInterfaz());