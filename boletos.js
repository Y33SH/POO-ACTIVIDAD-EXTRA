const DATABASE_KEY = 'uanl_transporte_db';
const MIN_RECHARGE_CENTS = 2000;
const MAX_RECHARGE_CENTS = 30000;
const DAILY_RECHARGE_LIMIT_CENTS = 30000;

class Tarifa {
    constructor(nombreServicio, tipo) {
        this.nombreServicio = nombreServicio;
        this.tipo = tipo;
    }

    calcularCosto() {
        throw new Error('La tarifa debe definir su propio costo.');
    }
}

class TarifaEstudiante extends Tarifa {
    constructor(nombreServicio) {
        super(nombreServicio, 'pasaje');
    }

    calcularCosto() {
        return 9.5;
    }
}

class TarifaTransmetro extends TarifaEstudiante {
    constructor() {
        super('Transmetro');
    }
}

class TarifaCamion extends Tarifa {
    constructor() {
        super('Camión');
    }

    calcularCosto() {
        return 10;
    }
}

class TarifaRutaIntegrada extends Tarifa {
    constructor() {
        super('Ruta Integrada', 'pasaje');
    }

    calcularCosto() {
        return 9.19;
    }
}

class BaseDatosLocal {
    static leer() {
        try {
            const database = JSON.parse(localStorage.getItem(DATABASE_KEY));
            if (database && database.account && Number.isInteger(database.balance) && Array.isArray(database.movements)) {
                return database;
            }
        } catch {
            localStorage.removeItem(DATABASE_KEY);
        }

        if (localStorage.getItem('uanl_transporte_auth') === 'true') {
            const legacyBalance = Math.round((Number(localStorage.getItem('saldo_urbani')) || 300) * 100);
            const migrated = {
                account: { phone: '', authenticated: true },
                balance: legacyBalance,
                movements: []
            };
            this.guardar(migrated);
            return migrated;
        }
        return null;
    }

    static guardar(database) {
        localStorage.setItem(DATABASE_KEY, JSON.stringify(database));
    }

    static cerrarSesion() {
        const database = this.leer();
        if (database) {
            database.account.authenticated = false;
            this.guardar(database);
        }
        localStorage.removeItem('uanl_transporte_auth');
    }
}

class GestorBilletera {
    constructor() {
        this.database = BaseDatosLocal.leer();
        if (!this.database || !this.database.account.authenticated) {
            window.location.replace('index.html');
            return;
        }

        this.amountDigits = '';
        this.qrInterval = null;
        this.inicializarEventos();
        this.renderizar();
    }

    get saldo() {
        return this.database.balance;
    }

    obtenerRecargasDeHoy() {
        const hoy = new Date().toDateString();
        return this.database.movements
            .filter((movement) => movement.type === 'recarga' && new Date(movement.createdAt).toDateString() === hoy)
            .reduce((total, movement) => total + movement.amount, 0);
    }

    renderizar() {
        document.getElementById('display-saldo').innerHTML = `${this.formatearPesos(this.saldo)} <small>mxn</small>`;
        document.getElementById('recharge-balance').textContent = this.formatearPesos(this.saldo);
        document.getElementById('daily-limit').textContent = this.formatearPesos(Math.max(0, DAILY_RECHARGE_LIMIT_CENTS - this.obtenerRecargasDeHoy()));
        this.renderizarUltimoViaje();
        this.renderizarHistorial();
        this.actualizarMontoRecarga();
    }

    formatearPesos(centavos, decimales = (centavos % 100 === 0 ? 0 : 2)) {
        return `$${(centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
    }

    inicializarEventos() {
        document.getElementById('tab-pasajes').addEventListener('click', () => this.mostrarVista('home'));
        document.getElementById('tab-recargas').addEventListener('click', () => this.mostrarVista('recharge'));
        document.getElementById('btn-ver-historial').addEventListener('click', () => this.mostrarVista('history'));
        document.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', () => this.mostrarVista('home')));
        document.querySelectorAll('[data-route]').forEach((button) => {
            button.addEventListener('click', () => {
                const service = button.dataset.route === 'metro' ? document.getElementById('metro-service').value : undefined;
                this.procesarCompra(this.crearTarifa(button.dataset.route, service));
            });
        });
        const metroService = document.getElementById('metro-service');
        metroService.addEventListener('change', () => {
            document.querySelector('.metro-acquire').disabled = metroService.value === '';
        });
        const transportList = document.querySelector('.transport-list');
        const slideButtons = [...document.querySelectorAll('[data-slide]')];
        slideButtons.forEach((button) => {
            button.addEventListener('click', () => {
                transportList.scrollTo({ left: Number(button.dataset.slide) * 177, behavior: 'smooth' });
            });
        });
        transportList.addEventListener('scroll', () => {
            const activeSlide = Math.round(transportList.scrollLeft / 177);
            slideButtons.forEach((button, index) => button.classList.toggle('active', index === activeSlide));
        }, { passive: true });

        document.getElementById('teclado-numerico').addEventListener('click', (event) => {
            const key = event.target.closest('button');
            if (!key) return;
            if (key.hasAttribute('data-delete')) this.amountDigits = this.amountDigits.slice(0, -1);
            else if (key.dataset.digit && this.amountDigits.length < 7) this.amountDigits += key.dataset.digit;
            this.actualizarMontoRecarga();
        });
        document.getElementById('btn-continuar-recarga').addEventListener('click', () => this.procesarRecarga());
        document.addEventListener('keydown', (event) => {
            if (document.getElementById('recharge-view').hidden) return;
            if (/^\d$/.test(event.key) && this.amountDigits.length < 7) this.amountDigits += event.key;
            else if (event.key === 'Backspace') this.amountDigits = this.amountDigits.slice(0, -1);
            else return;
            this.actualizarMontoRecarga();
        });

        document.getElementById('btn-cerrar-qr').addEventListener('click', () => this.cerrarQR());
        document.getElementById('qr-container').addEventListener('click', (event) => {
            if (event.target.id === 'qr-container') this.cerrarQR();
        });
        document.getElementById('btn-cerrar-sesion').addEventListener('click', () => {
            BaseDatosLocal.cerrarSesion();
            window.location.href = 'index.html';
        });
    }

    crearTarifa(route, service) {
        const tarifas = {
            metro: () => service === 'Transmetro' ? new TarifaTransmetro() : new TarifaEstudiante('Metro'),
            transmetro: () => new TarifaTransmetro(),
            bus: () => new TarifaCamion(),
            'ruta-integrada': () => new TarifaRutaIntegrada()
        };
        return tarifas[route]();
    }

    procesarCompra(tarifa) {
        const costo = Math.round(tarifa.calcularCosto() * 100);
        if (this.saldo < costo) {
            this.mostrarEstado(`Saldo insuficiente. Necesitas ${this.formatearPesos(costo)} para ${tarifa.nombreServicio}.`);
            return;
        }

        const movement = {
            id: this.crearId(),
            type: 'pasaje',
            service: tarifa.nombreServicio,
            amount: costo,
            createdAt: new Date().toISOString()
        };
        this.database.balance -= costo;
        this.database.movements.unshift(movement);
        BaseDatosLocal.guardar(this.database);
        this.renderizar();
        this.mostrarQR(movement);
    }

    procesarRecarga() {
        const amount = Number(this.amountDigits || 0) * 100;
        const dailyRoom = Math.max(0, DAILY_RECHARGE_LIMIT_CENTS - this.obtenerRecargasDeHoy());
        const limit = Math.min(MAX_RECHARGE_CENTS, dailyRoom);
        if (amount < MIN_RECHARGE_CENTS || amount > limit) {
            document.getElementById('mensaje-recarga').textContent = amount < MIN_RECHARGE_CENTS
                ? 'La recarga mínima es de $20.00 mxn.'
                : `Puedes recargar hasta ${this.formatearPesos(limit)} hoy.`;
            return;
        }

        this.database.balance += amount;
        this.database.movements.unshift({
            id: this.crearId(),
            type: 'recarga',
            service: 'Recarga de saldo',
            amount,
            createdAt: new Date().toISOString()
        });
        BaseDatosLocal.guardar(this.database);
        this.amountDigits = '';
        document.getElementById('mensaje-recarga').textContent = 'Saldo recargado correctamente.';
        document.getElementById('mensaje-recarga').style.color = '#188038';
        this.renderizar();
        this.mostrarVista('home');
        this.mostrarEstado('Saldo recargado correctamente.');
    }

    actualizarMontoRecarga() {
        const amount = Number(this.amountDigits || 0) * 100;
        document.getElementById('recharge-amount').textContent = Number(this.amountDigits || 0).toLocaleString('es-MX', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        document.getElementById('btn-continuar-recarga').disabled = amount < MIN_RECHARGE_CENTS || amount > Math.min(MAX_RECHARGE_CENTS, DAILY_RECHARGE_LIMIT_CENTS - this.obtenerRecargasDeHoy());
        const message = document.getElementById('mensaje-recarga');
        if (message.textContent !== 'Saldo recargado correctamente.') {
            message.textContent = '';
            message.style.color = '';
        }
    }

    mostrarVista(viewName) {
        document.querySelectorAll('.wallet-view').forEach((view) => {
            view.hidden = view.id !== `${viewName}-view`;
        });
        if (viewName === 'home') {
            document.querySelector('.transport-list').scrollLeft = 0;
            document.querySelectorAll('[data-slide]').forEach((button, index) => {
                button.classList.toggle('active', index === 0);
            });
        }
        document.body.classList.toggle('recharge-page', viewName === 'recharge' || viewName === 'history');
        document.getElementById('tab-pasajes').classList.toggle('active', viewName === 'home');
        document.getElementById('tab-recargas').classList.toggle('active', viewName === 'recharge');
        if (viewName === 'recharge') {
            this.amountDigits = '';
            document.getElementById('mensaje-recarga').textContent = '';
            this.renderizar();
        }
        window.scrollTo(0, 0);
    }

    renderizarUltimoViaje() {
        const lastTrip = this.database.movements.find((movement) => movement.type === 'pasaje');
        const container = document.getElementById('ultimo-viaje');
        if (!lastTrip) {
            container.innerHTML = '<p class="empty-state">Aún no tienes viajes.</p>';
            return;
        }
        const icon = lastTrip.service === 'Camión' ? 'assets/bus-small.svg' : 'assets/train.svg';
        container.innerHTML = `<img src="${icon}" alt="" width="24" height="24"><div class="latest-details"><strong>${this.escapeHtml(lastTrip.service)}</strong><span>${this.formatearFecha(lastTrip.createdAt)}</span></div><strong class="latest-cost">${this.formatearPesos(lastTrip.amount)} mxn</strong>`;
    }

    renderizarHistorial() {
        const trips = this.database.movements.filter((movement) => movement.type === 'pasaje');
        const container = document.getElementById('historial-pasajes');
        if (trips.length === 0) {
            container.innerHTML = '<p class="empty-state">Aún no tienes pasajes. Tus viajes aparecerán aquí.</p>';
            return;
        }
        container.innerHTML = trips.map((trip) => {
            const date = new Date(trip.createdAt);
            const day = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '');
            const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
            return `<article class="history-card"><div class="history-date"><span>${day}</span><time>${time}</time></div><div class="history-fare"><strong>${this.escapeHtml(trip.service)}</strong><strong>${this.formatearPesos(trip.amount)} mxn</strong></div><hr><div class="transaction-id"><span>ID de transacción</span><strong>${this.escapeHtml(trip.id)}</strong></div></article>`;
        }).join('');
    }

    mostrarQR(movement) {
        document.getElementById('qr-route').textContent = `${movement.service} · ${this.formatearPesos(movement.amount)} mxn`;
        document.getElementById('qr-id').textContent = `ID ${movement.id}`;
        const qrContainer = document.getElementById('qrcode');
        qrContainer.replaceChildren();
        if (typeof QRCode === 'function') {
            new QRCode(qrContainer, {
                text: JSON.stringify({ id: movement.id, service: movement.service }),
                width: 220,
                height: 220,
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            qrContainer.textContent = 'No se pudo cargar el código QR.';
        }
        document.getElementById('qr-container').hidden = false;
        let seconds = 15 * 60;
        this.actualizarTemporizador(seconds);
        clearInterval(this.qrInterval);
        this.qrInterval = setInterval(() => {
            seconds -= 1;
            if (seconds <= 0) this.cerrarQR();
            else this.actualizarTemporizador(seconds);
        }, 1000);
    }

    actualizarTemporizador(seconds) {
        const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
        const remainder = String(seconds % 60).padStart(2, '0');
        document.getElementById('tiempo-restante').textContent = `Válido por ${minutes}:${remainder} min`;
    }

    cerrarQR() {
        document.getElementById('qr-container').hidden = true;
        clearInterval(this.qrInterval);
    }

    crearId() {
        const date = new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
        return `URB-${stamp}`;
    }

    formatearFecha(value) {
        const date = new Date(value);
        const day = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '');
        const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
        return `${day} · ${time}`;
    }

    escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    }

    mostrarEstado(message) {
        document.getElementById('wallet-status').textContent = message;
    }
}

document.addEventListener('DOMContentLoaded', () => new GestorBilletera());