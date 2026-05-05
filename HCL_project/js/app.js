/**
 * Main Application Logic
 * Handles Routing and UI rendering
 */

const App = (() => {
    const container = document.getElementById('app-container');
    const navLinks = document.getElementById('nav-links');

    // Theme Logic
    const initTheme = () => {
        const saved = localStorage.getItem('smartpark_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcon(saved);
    };

    const updateThemeIcon = (theme) => {
        const btn = document.getElementById('theme-toggle');
        if(btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    };

    const tBtn = document.getElementById('theme-toggle');
    if (tBtn) {
        tBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('smartpark_theme', next);
            updateThemeIcon(next);
        });
    }

    initTheme();

    const ws = new WebSocket('ws://localhost:8080/ws');
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'SYNC') {
                localStorage.setItem('smartpark_locations', data.locs);
                localStorage.setItem('smartpark_bookings', data.bookings);
                window.dispatchEvent(new Event('syncEvent'));
            }
        } catch(err){}
    };
    
    const pushSync = () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'SYNC',
                locs: localStorage.getItem('smartpark_locations'),
                bookings: localStorage.getItem('smartpark_bookings')
            }));
        }
    };

    const Database = {
        getLocations: (lat, lng) => {
            let locs = JSON.parse(localStorage.getItem('smartpark_locations'));
            if (!locs || locs.length === 0) {
                locs = generateAndSaveLocations(lat, lng);
            }
            return locs;
        },
        getLocation: (id) => {
            const locs = JSON.parse(localStorage.getItem('smartpark_locations') || '[]');
            return locs.find(l => l.id === id);
        },
        updateSlot: (locId, slotId, status, lockedUntil = null) => {
            const locs = JSON.parse(localStorage.getItem('smartpark_locations') || '[]');
            const loc = locs.find(l => l.id === locId);
            if (loc) {
                const sl = loc.slots.find(s => s.id === slotId);
                // Allow transition from available->reserved or reserved->reserved
                if (sl && status === 'reserved' && sl.status !== 'available' && sl.status !== 'reserved') return false;
                if (sl) {
                    sl.status = status;
                    if (status === 'reserved' && lockedUntil) {
                        sl.lockedUntil = lockedUntil;
                    } else if (status !== 'reserved') {
                        delete sl.lockedUntil;
                    }
                }
                localStorage.setItem('smartpark_locations', JSON.stringify(locs));
                pushSync();
                return true;
            }
            return false;
        },
        cleanExpiredBookings: () => {
            const now = Date.now();
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            let currentUser = null;
            try { currentUser = JSON.parse(localStorage.getItem('smartpark_currentUser')); } catch(e){}
            
            let changed = false;
            bookings.forEach(b => {
                if (!b.expired) {
                    const expiresAt = b.startTime + (b.duration * 60 * 60 * 1000);
                    if (now >= expiresAt) {
                        Database.updateSlot(b.locId, b.slotId, 'available');
                        b.expired = true;
                        changed = true;
                        
                        // Push Expiry Notification to current active user
                        if (currentUser && currentUser.id === b.userId && typeof showNotification === 'function') {
                            showNotification(`Your booking for Slot #${b.slotId} at ${b.locName} has officially expired!`, 'error');
                        }
                    }
                }
            });
            if (changed) {
                localStorage.setItem('smartpark_bookings', JSON.stringify(bookings));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
            }

            const locs = JSON.parse(localStorage.getItem('smartpark_locations') || '[]');
            let locsChanged = false;
            locs.forEach(l => {
                l.slots.forEach(s => {
                    if (s.status === 'reserved' && s.lockedUntil && now >= s.lockedUntil) {
                        s.status = 'available';
                        delete s.lockedUntil;
                        locsChanged = true;
                    }
                });
            });
            if (locsChanged) {
                localStorage.setItem('smartpark_locations', JSON.stringify(locs));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
            }
        },
        cancelBooking: (bookingId) => {
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            const b = bookings.find(x => x.id === bookingId);
            if(b && !b.expired) {
                Database.updateSlot(b.locId, b.slotId, 'available');
                b.expired = true;
                b.cancelled = true;
                
                const now = Date.now();
                if (now <= b.startTime) {
                    b.refundStatus = "100% Refunded (₹" + b.totalPrice.toLocaleString('en-IN') + ")";
                } else {
                    const elapsedHours = (now - b.startTime) / (1000 * 60 * 60);
                    if (elapsedHours >= b.duration) {
                        b.refundStatus = "No Refund";
                    } else {
                        const remaining = b.duration - elapsedHours;
                        const partial = remaining * (b.totalPrice / b.duration);
                        b.refundStatus = "Partial Refund (₹" + partial.toLocaleString('en-IN', {maximumFractionDigits: 2}) + ")";
                    }
                }

                localStorage.setItem('smartpark_bookings', JSON.stringify(bookings));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
                return b.refundStatus;
            }
            return null;
        },
        checkInBooking: (bookingId) => {
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            const b = bookings.find(x => x.id === bookingId);
            if(b && !b.expired) {
                Database.updateSlot(b.locId, b.slotId, 'occupied');
                b.checkedIn = true;
                localStorage.setItem('smartpark_bookings', JSON.stringify(bookings));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
                return true;
            }
            return false;
        },
        checkOutBooking: (bookingId) => {
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            const b = bookings.find(x => x.id === bookingId);
            if(b && !b.expired) {
                Database.updateSlot(b.locId, b.slotId, 'available');
                b.expired = true;
                b.checkedOut = true;
                localStorage.setItem('smartpark_bookings', JSON.stringify(bookings));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
                return true;
            }
            return false;
        },
        createBooking: (userId, locId, slotId, duration, price, vehicleNo, vehicleType) => {
            const success = Database.updateSlot(locId, slotId, 'reserved');
            if (!success) throw new Error("Slot state verification failed.");
            
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            const loc = Database.getLocation(locId);
            const gracePeriod = 10 * 60 * 1000; // 10 minutes grace period acts as 'start time' in mock
            const newBooking = {
                id: 'bk-' + Date.now(),
                userId, locId, slotId, locName: loc.name, duration,
                checkedIn: false,
                vehicleNo: vehicleNo || 'Unknown',
                vehicleType: vehicleType || 'Car',
                totalPrice: duration * price, startTime: Date.now() + gracePeriod
            };
            bookings.push(newBooking);
            localStorage.setItem('smartpark_bookings', JSON.stringify(bookings));
            window.dispatchEvent(new Event('syncEvent'));
            pushSync();
            return newBooking;
        },
        getBookings: (userId) => {
            Database.cleanExpiredBookings();
            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            return bookings.filter(b => b.userId === userId && !b.expired);
        }
    };

    const generateAndSaveLocations = (lat, lng) => {
        const names = ["Downtown Core Center", "City Mall Parking", "Alpha Street Garage", "Central Station Spots", "Express Flow Parking"];
        const prices = [100, 60, 80, 120, 50];
        const locs = [];
        for(let i = 0; i < 5; i++) {
            const dLat = (Math.random() - 0.5) * 0.02;
            const dLng = (Math.random() - 0.5) * 0.02;
            const totalSlots = Math.floor(Math.random() * 20) + 12;
            const slots = [];
            for (let j=1; j<=totalSlots; j++) {
                const r = Math.random();
                let st = 'available';
                if (r > 0.8) st = 'occupied';
                else if (r > 0.6) st = 'reserved';
                slots.push({ id: j, status: st });
            }
            locs.push({
                id: 'loc-' + i,
                name: names[i],
                lat: lat + dLat,
                lng: lng + dLng,
                price: prices[i],
                totalSlots: totalSlots,
                slots: slots
            });
        }
        localStorage.setItem('smartpark_locations', JSON.stringify(locs));
        return locs;
    };

    // SVGs for Icons
    const icons = {
        mapPin: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
        clock: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        car: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a2 2 0 0 0-1.6-.8H9.3a2 2 0 0 0-1.6.8L5 11l-5.16.86a1 1 0 0 0-.84.99V16h3m10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM5 16a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"></path></svg>`,
        user: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
    };

    const showNotification = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconHtml = '';
        if (type === 'success') iconHtml = `<div style="color:var(--success); font-size:1.5rem;">✓</div>`;
        else if (type === 'warning') iconHtml = `<div style="color:#feca57; font-size:1.5rem;">⚠️</div>`;
        else if (type === 'error') iconHtml = `<div style="color:var(--error); font-size:1.5rem;">✖</div>`;

        toast.innerHTML = `
            ${iconHtml}
            <div style="font-size:0.875rem; font-weight:500;">${message}</div>
        `;

        container.appendChild(toast);
        
        // Animate in
        setTimeout(() => { toast.classList.add('show'); }, 10);
        
        // Animate out and remove
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.remove(); }, 400); 
        }, 4000);
    };

    // --- Views ---

    const Views = {
        landing: () => `
            <div class="landing-bg"></div>
            
            <!-- Hero Section -->
            <div class="landing-section animate-fade-in" style="min-height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 2rem; padding-top: 100px;">
                <h1 class="hero-title" style="font-size: clamp(3rem, 8vw, 5rem); margin-bottom: 1.5rem; max-width: 800px; line-height: 1.1;">Find Parking Instantly. Save Time. Drive Smart.</h1>
                <p class="hero-subtitle" style="font-size: 1.3rem; color: var(--text-secondary); max-width: 600px; margin-bottom: 3rem;">Real-time parking availability, easy booking, and seamless navigation.</p>
                <div class="hero-cta animate-slide-up delay-200">
                    <button class="btn btn-primary" data-link="/map" style="padding: 1rem 2rem; font-size: 1.1rem; border-radius: 50px;">🔍 Find Parking</button>
                    ${Auth.isAuthenticated() ? 
                        `<button class="btn btn-secondary" data-link="/dashboard" style="padding: 1rem 2rem; font-size: 1.1rem; border-radius: 50px;">Go to Dashboard</button>` 
                        : 
                        `<button class="btn btn-secondary" data-link="/register" style="padding: 1rem 2rem; font-size: 1.1rem; border-radius: 50px;">Get Started</button>`
                    }
                </div>
            </div>

            <!-- Features Section -->
            <div class="landing-section scroll-animate" style="padding: 5rem 2rem; max-width: 1200px; margin: 0 auto;">
                <h2 style="text-align: center; font-size: 2.5rem; margin-bottom: 3rem;">Why SmartPark?</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem;">
                    <div class="card glass-panel action-card" style="text-align: center;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
                        <h3 style="margin-bottom: 0.5rem;">Real-Time Availability</h3>
                        <p style="color: var(--text-secondary);">See which parking slots are free instantly before you even arrive.</p>
                    </div>
                    <div class="card glass-panel action-card" style="text-align: center;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">📍</div>
                        <h3 style="margin-bottom: 0.5rem;">Nearby Parking</h3>
                        <p style="color: var(--text-secondary);">Find the closest, cheapest parking spaces near your location.</p>
                    </div>
                    <div class="card glass-panel action-card" style="text-align: center;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">⏱️</div>
                        <h3 style="margin-bottom: 0.5rem;">Easy Booking</h3>
                        <p style="color: var(--text-secondary);">Reserve your spot securely in seconds.</p>
                    </div>
                    <div class="card glass-panel action-card" style="text-align: center;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">🧭</div>
                        <h3 style="margin-bottom: 0.5rem;">Navigation</h3>
                        <p style="color: var(--text-secondary);">Get directions directly to your parking spot securely natively.</p>
                    </div>
                </div>
            </div>

            <!-- How It Works & Live Preview -->
            <div class="landing-section scroll-animate" style="padding: 5rem 2rem; background: var(--bg-secondary); border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color);">
                <div style="max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 4rem; align-items: center;">
                    <div>
                        <h2 style="font-size: 2.5rem; margin-bottom: 2rem;">How It Works</h2>
                        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                                <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #000; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">1</div>
                                <div>
                                    <h4 style="font-size: 1.2rem; margin-bottom: 0.25rem;">Open the App</h4>
                                    <p style="color: var(--text-secondary);">Launch SmartPark and enable location services.</p>
                                </div>
                            </div>
                            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                                <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #000; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">2</div>
                                <div>
                                    <h4 style="font-size: 1.2rem; margin-bottom: 0.25rem;">Find Nearby Parking</h4>
                                    <p style="color: var(--text-secondary);">Browse dynamic real-time map zones.</p>
                                </div>
                            </div>
                            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                                <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #000; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">3</div>
                                <div>
                                    <h4 style="font-size: 1.2rem; margin-bottom: 0.25rem;">Book Your Slot</h4>
                                    <p style="color: var(--text-secondary);">Tap to reserve, lock it in, and process payment securely.</p>
                                </div>
                            </div>
                            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                                <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #000; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">4</div>
                                <div>
                                    <h4 style="font-size: 1.2rem; margin-bottom: 0.25rem;">Navigate & Park</h4>
                                    <p style="color: var(--text-secondary);">Drive to the destination, scan your QR receipt and deploy!</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card glass-panel" style="background: rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 1.5rem; text-align: center;">Live Garage Preview</h3>
                        <div style="display: flex; justify-content: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
                            <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 12px; height: 12px; background: rgba(46, 213, 115, 0.2); border: 2px solid var(--success); border-radius: 50%;"></div> Available</span>
                            <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 12px; height: 12px; background: rgba(254, 202, 87, 0.2); border: 2px solid #feca57; border-radius: 50%;"></div> Reserved</span>
                            <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 12px; height: 12px; background: rgba(255, 71, 87, 0.2); border: 2px solid var(--error); border-radius: 50%;"></div> Occupied</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem;">
                            <div class="slot slot-occupied">1</div>
                            <div class="slot slot-available">2</div>
                            <div class="slot slot-available">3</div>
                            <div class="slot slot-reserved">4</div>
                            <div class="slot slot-occupied">5</div>
                            <div class="slot slot-occupied">6</div>
                            <div class="slot slot-available">7</div>
                            <div class="slot slot-available">8</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Why Choose Us -->
            <div class="landing-section scroll-animate" style="padding: 5rem 2rem; max-width: 1000px; margin: 0 auto; text-align: center;">
                <h2 style="font-size: 2.5rem; margin-bottom: 3rem;">Why Choose SmartPark?</h2>
                <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem;">
                    <span style="background: var(--bg-surface); padding: 1rem 2rem; border-radius: 50px; border: 1px solid var(--border-color); font-weight: 500;">✓ Save Time & Fuel</span>
                    <span style="background: var(--bg-surface); padding: 1rem 2rem; border-radius: 50px; border: 1px solid var(--border-color); font-weight: 500;">✓ Avoid Parking Stress</span>
                    <span style="background: var(--bg-surface); padding: 1rem 2rem; border-radius: 50px; border: 1px solid var(--border-color); font-weight: 500;">✓ Smart & Reliable System</span>
                    <span style="background: var(--bg-surface); padding: 1rem 2rem; border-radius: 50px; border: 1px solid var(--border-color); font-weight: 500;">✓ Instant Real-time Updates</span>
                </div>
            </div>

            <!-- CTA Section -->
            <div class="landing-section" style="padding: 6rem 2rem; background: linear-gradient(135deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-top: 1px solid var(--glass-border); text-align: center;">
                <h2 style="font-size: 3rem; margin-bottom: 1rem;">Start Parking Smarter Today</h2>
                <p style="color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.2rem;">Join thousands of drivers making city mobility effortless.</p>
                <button class="btn btn-primary" data-link="/map" style="padding: 1.2rem 3rem; font-size: 1.2rem; border-radius: 50px;">Find Parking Now</button>
            </div>

            <!-- Footer -->
            <footer style="padding: 3rem 2rem; border-top: 1px solid var(--border-color); background: var(--bg-secondary); margin: 0 -2rem -2rem -2rem;">
                <div style="max-width: 1200px; margin: 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2rem;">
                    <div>
                        <div style="font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                            <span style="color: var(--accent);">${icons.car}</span> SmartPark
                        </div>
                        <p style="color: var(--text-secondary); max-width: 300px;">Revolutionizing urban mobility with smart, real-time parking solutions.</p>
                    </div>
                    
                    <div style="display: flex; gap: 4rem; flex-wrap: wrap;">
                        <div>
                            <h4 style="margin-bottom: 1rem; color: var(--text-primary);">Links</h4>
                            <ul style="list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                                <li><a href="#/" style="color: var(--text-secondary);">Home</a></li>
                                <li><a href="#/map" style="color: var(--text-secondary);">Map</a></li>
                                <li><a href="#/dashboard" style="color: var(--text-secondary);">Dashboard</a></li>
                                <li><a href="#/profile" style="color: var(--text-secondary);">Profile</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 style="margin-bottom: 1rem; color: var(--text-primary);">Contact</h4>
                            <ul style="list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; color: var(--text-secondary);">
                                <li>support@smartpark.com</li>
                                <li>+91 98765 43210</li>
                                <li>123 Smart City Hub</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div style="border-top: 1px solid var(--border-color); margin-top: 3rem; padding-top: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
                    &copy; 2026 Smart Parking System. All rights reserved.
                </div>
            </footer>
        `,

        login: () => `
            <div class="auth-page animate-fade-in">
                <div class="card glass-panel auth-form-container border-glow">
                    <h2 class="auth-title">Welcome Back</h2>
                    <p class="auth-subtitle">Login to manage your parking spots</p>
                    <div id="login-error" class="error-msg"></div>
                    <form id="login-form">
                        <div class="form-group">
                            <label class="form-label">Email Address</label>
                            <input type="email" id="email" class="form-control" required placeholder="name@example.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" id="password" class="form-control" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Login</button>
                        <p style="text-align: center; margin-top: 1.5rem; color: var(--text-secondary); font-size: 0.875rem;">
                            Don't have an account? <a href="#" data-link="/register">Register</a>
                        </p>
                    </form>
                </div>
            </div>
        `,

        adminLogin: () => `
            <div class="auth-page animate-fade-in">
                <div class="card glass-panel auth-form-container border-glow" style="border-color: var(--error);">
                    <div class="brand-icon" style="justify-content:center; margin-bottom:1rem; color:var(--error);">${icons.user}</div>
                    <h2 class="auth-title" style="color:var(--error);">Admin Portal</h2>
                    <p class="auth-subtitle">Secure management access</p>
                    <div id="admin-login-error" class="error-msg"></div>
                    <form id="admin-login-form">
                        <div class="form-group">
                            <label class="form-label">Admin Email</label>
                            <input type="email" id="admin-email" class="form-control" required placeholder="admin@admin.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Secret Key</label>
                            <input type="password" id="admin-password" class="form-control" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem; background:var(--error); box-shadow:0 4px 14px rgba(255,71,87,0.4);">Secure Login</button>
                    </form>
                    <button class="btn btn-secondary" data-link="/login" style="width: 100%; margin-top: 1.5rem;">← Back to User Login</button>
                </div>
            </div>
        `,

        register: () => `
            <div class="auth-page animate-fade-in">
                <div class="card glass-panel auth-form-container">
                    <h2 class="auth-title">Create Account</h2>
                    <p class="auth-subtitle">Join the smart parking network</p>
                    <div id="register-error" class="error-msg"></div>
                    <form id="register-form">
                        <div class="form-group">
                            <label class="form-label">Full Name</label>
                            <input type="text" id="name" class="form-control" required placeholder="John Doe">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email Address</label>
                            <input type="email" id="email" class="form-control" required placeholder="name@example.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" id="password" class="form-control" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Create Account</button>
                        <p style="text-align: center; margin-top: 1.5rem; color: var(--text-secondary); font-size: 0.875rem;">
                            Already have an account? <a href="#" data-link="/login">Login</a>
                        </p>
                    </form>
                </div>
            </div>
        `,

        adminDashboard: () => {
            const user = Auth.getUser();
            if (!user || user.role !== 'admin') return '<h1 style="text-align:center; padding: 4rem;">Unauthorized.</h1>';

            const bookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]');
            const locs = JSON.parse(localStorage.getItem('smartpark_locations') || '[]');
            
            const revenue = bookings.reduce((sum, b) => sum + b.totalPrice, 0);
            
            let totalSlots = 0;
            let occupiedSlots = 0;
            locs.forEach(l => {
                totalSlots += l.totalSlots;
                occupiedSlots += l.slots.filter(s => s.status !== 'available').length;
            });
            const occupancyRate = totalSlots > 0 ? ((occupiedSlots / totalSlots) * 100).toFixed(1) : 0;

            // Time grouping for Total Bookings
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            const dailyB = bookings.filter(b => (now - b.startTime) <= dayMs).length;
            const weeklyB = bookings.filter(b => (now - b.startTime) <= dayMs * 7).length;
            const monthlyB = bookings.filter(b => (now - b.startTime) <= dayMs * 30).length;

            // Most used locations
            const locCounts = {};
            bookings.forEach(b => locCounts[b.locName] = (locCounts[b.locName] || 0) + 1);
            let topLoc = 'None';
            let topLocCount = 0;
            Object.keys(locCounts).forEach(k => {
                if (locCounts[k] > topLocCount) { topLocCount = locCounts[k]; topLoc = k; }
            });

            // Peak hours analysis
            const hrCounts = {};
            bookings.forEach(b => {
                const hr = new Date(b.startTime).getHours();
                hrCounts[hr] = (hrCounts[hr] || 0) + 1;
            });
            let peakHr = 12;
            let peakCount = -1;
            Object.keys(hrCounts).forEach(h => {
                if(hrCounts[h] > peakCount) { peakCount = hrCounts[h]; peakHr = parseInt(h); }
            });
            const formatHr = h => (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM');
            const peakStr = peakCount > 0 ? `${formatHr(peakHr)} - ${formatHr(peakHr+1)}` : 'N/A';

            // Chart data: Last 7 days dynamically
            const chartLabels = [];
            const revData = [];
            const countsData = [];
            for (let i = 6; i >= 0; i--) {
                const targetDay = new Date(now - i * dayMs);
                chartLabels.push(targetDay.toLocaleDateString('en-US', {weekday: 'short'}));
                const dayBks = bookings.filter(b => new Date(b.startTime).toDateString() === targetDay.toDateString());
                revData.push(dayBks.reduce((s, b) => s + b.totalPrice, 0));
                countsData.push(dayBks.length);
            }
            window.adminMetricsData = { chartLabels, revData, countsData };

            const locsRows = locs.map(l => `
                <tr>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${l.name}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">₹${l.price.toLocaleString('en-IN')}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${l.totalSlots}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);"><button class="btn btn-secondary" onclick="window.location.hash='/parking/${l.id}'" style="padding: 0.25rem 0.75rem; font-size:0.875rem;">Manage Slots</button></td>
                </tr>
            `).join('');

            const bookingsRows = [...bookings].reverse().slice(0, 15).map(b => `
                <tr>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-family: monospace;">${b.id.slice(0,8)}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.locName}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Slot #${b.slotId}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.vehicleNo || 'Any'} (${b.vehicleType || 'Any'})</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.duration}h</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">₹${b.totalPrice.toLocaleString('en-IN')}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.cancelled ? '<span style="color:var(--error)">Cancelled</span>' : (b.expired ? '<span style="color:var(--text-muted)">Completed</span>' : '<span style="color:var(--success)">Active</span>')}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-size: 0.85rem; color: var(--success);">${b.refundStatus || (b.cancelled ? 'No Refund' : '-')}</td>
                </tr>
            `).join('');

            return `
            <div class="dashboard-page animate-fade-in" style="max-width: 1000px;">
                <div class="dashboard-header animate-slide-up">
                    <div>
                        <h2>Admin Dashboard 🔒</h2>
                        <p style="color: var(--text-secondary);">System overview and management console.</p>
                    </div>
                    <button class="btn btn-primary" id="add-location-btn">+ Add Location Map</button>
                </div>

                <div class="dash-grid animate-slide-up delay-100" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                    <div class="card glass-panel metric-card">
                        <span style="color: var(--text-secondary); font-weight: 500;">Total Revenue</span>
                        <div class="metric-v" style="font-size: 2rem; color: var(--accent);">₹${revenue.toLocaleString('en-IN')}</div>
                    </div>
                    <div class="card glass-panel metric-card">
                        <span style="color: var(--text-secondary); font-weight: 500;">Capacity Occupancy</span>
                        <div class="metric-v" style="font-size: 2rem; color: ${occupancyRate > 80 ? 'var(--error)' : 'white'};">${occupancyRate}%</div>
                    </div>
                    <div class="card glass-panel metric-card">
                        <span style="color: var(--text-secondary); font-weight: 500;">Total Bookings <span style="font-size:0.7rem;">(24h | 7d | 30d)</span></span>
                        <div class="metric-v" style="font-size: 1.5rem;">${dailyB} | ${weeklyB} | ${monthlyB}</div>
                    </div>
                    <div class="card glass-panel metric-card">
                        <span style="color: var(--text-secondary); font-weight: 500;">Peak Hrs & Top Garages</span>
                        <div class="metric-v" style="font-size: 1.25rem;">${peakStr}</div>
                        <p style="font-size: 0.85rem; color: #ffd32a; font-weight: bold; margin-top: 0.25rem;">⭐ ${topLoc}</p>
                    </div>
                </div>

                <div class="card glass-panel animate-slide-up delay-100" style="margin-top: 1.5rem;">
                    <h3 style="margin-bottom: 1rem;">Revenue & Bookings Trend</h3>
                    <div style="height: 300px; width: 100%;">
                        <canvas id="admin-chart"></canvas>
                    </div>
                </div>

                <div class="card glass-panel animate-slide-up delay-200" style="margin-top: 2rem;">
                    <h3>Managed Locations</h3>
                    <div style="overflow-x: auto; margin-top: 1rem;">
                        <table style="width: 100%; text-align: left; border-collapse: collapse;">
                            <thead>
                                <tr style="color: var(--text-secondary);">
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Name</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Price/Hr</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Total Slots</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${locsRows}</tbody>
                        </table>
                    </div>
                </div>

                <div class="card glass-panel animate-slide-up delay-200" style="margin-top: 2rem;">
                    <h3>Recent Bookings History</h3>
                    <div style="overflow-x: auto; margin-top: 1rem;">
                        <table style="width: 100%; text-align: left; border-collapse: collapse;">
                            <thead>
                                <tr style="color: var(--text-secondary);">
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Ref ID</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Location</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Slot</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Vehicle</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Duration</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Price</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Status</th>
                                    <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Refund</th>
                                </tr>
                            </thead>
                            <tbody>${bookingsRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
            `;
        },

        dashboard: () => {
            const user = Auth.getUser() || { name: 'User' };
            Database.cleanExpiredBookings(); // ensure up to date
            const allBookings = JSON.parse(localStorage.getItem('smartpark_bookings') || '[]').filter(b => b.userId === user.id);
            const activeBookings = allBookings.filter(b => !b.expired);
            const pastBookings = allBookings.filter(b => b.expired).reverse();

            // Active Bookings UI
            let activeBookingsHtml = '';
            if (activeBookings.length > 0) {
                activeBookingsHtml = activeBookings.map(ab => { // Supports multiple parallel bookings by 1 user
                    const expiresAt = ab.startTime + (ab.duration * 60 * 60 * 1000);
                    return `
                        <div class="card glass-panel metric-card" style="margin-bottom: 1rem; border-left: 4px solid var(--accent);">
                            <div style="display:flex; justify-content: space-between; align-items: start;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Booking #${ab.id.slice(0, 8)}</span>
                                <div class="brand-icon">${icons.car}</div>
                            </div>
                            <div class="metric-v" style="font-size: 1.5rem; margin: 0.5rem 0;">Slot #${ab.slotId}</div>
                            <span style="color: var(--accent); font-size: 0.875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;">@ ${ab.locName}</span>
                            <span class="active-timer" data-expires="${expiresAt}" data-booking-id="${ab.id}" data-slot-id="${ab.slotId}" style="color: var(--text-primary); font-size: 1.1rem; font-weight: 600; display: block; margin-top: 0.75rem;">Calculating...</span>
                            <div style="display: flex; gap: 1rem; align-items: center; margin-top: 1.25rem; flex-wrap: wrap; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem; min-width: 130px;">
                                    ${ab.checkedIn ? 
                                        `<button class="btn btn-primary checkout-btn" data-booking-id="${ab.id}" style="padding: 0.5rem; font-size: 0.85rem; display: flex; align-items:center; justify-content:center; background: var(--error);">Check-Out Now</button>` 
                                        : 
                                        `<button class="btn btn-primary checkin-btn" data-booking-id="${ab.id}" data-lat="${Database.getLocation(ab.locId).lat}" data-lng="${Database.getLocation(ab.locId).lng}" style="padding: 0.5rem; font-size: 0.85rem; display: flex; align-items:center; justify-content:center; background: var(--success); border-color: var(--success);">Check-In</button>
                                         <button class="btn btn-secondary cancel-booking-btn" data-booking-id="${ab.id}" style="padding: 0.5rem; font-size: 0.85rem; display: flex; align-items:center; justify-content:center;">Cancel</button>`
                                    }
                                    <a href="https://www.google.com/maps/dir/?api=1&destination=${Database.getLocation(ab.locId).lat},${Database.getLocation(ab.locId).lng}" target="_blank" class="btn btn-secondary" style="width: 100%; padding: 0.5rem; font-size: 0.85rem; display: flex; align-items:center; justify-content:center; margin-top: 0.25rem;">Navigate</a>
                                </div>
                                <div style="background: white; padding: 0.4rem; border-radius: 8px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3); text-align: center;">
                                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(JSON.stringify({id: ab.id, loc: ab.locId, slot: ab.slotId}))}" alt="Entry QR Code" style="display: block; width: 90px; height: 90px; border-radius: 4px;">
                                    <div style="font-size: 0.6rem; color: #1e272e; margin-top: 5px; font-weight: bold; font-family: monospace; letter-spacing: 0.5px;">E-PASS</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                const { bestLoc, bestDist } = getBestRecommendation(lastKnownLat, lastKnownLng);
                let suggestionHtml = '';

                if(bestLoc && bestDist <= 5) {
                    const distText = userLocationEnabled ? Number(bestDist).toFixed(2) + ' km away' : 'Location Unknown';
                    suggestionHtml = `
                        <div class="brand-icon" style="background:rgba(255, 211, 42, 0.2); color:#ffa801; margin-bottom:1rem; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">⭐</div>
                        <h4 style="margin: 0.5rem 0; color:var(--text-secondary);">Best Parking Near You:</h4>
                        <div class="metric-v" style="font-size:1.25rem;">${bestLoc.name}</div>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; margin-bottom: 0.5rem;">
                            <span style="color: var(--text-secondary); font-size:0.875rem;">📍 Distance: <span style="color: white; font-weight: bold;">${distText}</span></span>
                            <span style="color: var(--text-secondary); font-size:0.875rem;">💰 Price: <span style="color: white; font-weight: bold;">₹${bestLoc.price.toLocaleString('en-IN')}/hr</span></span>
                            <span style="color: var(--text-secondary); font-size:0.875rem;">🚗 Available: <span style="color: var(--success); font-weight: bold;">${bestLoc.slots.filter(s => s.status === 'available').length} slots</span></span>
                        </div>
                        <button class="btn btn-primary" onclick="window.location.hash='#/parking/${bestLoc.id}'" style="margin-top: 0.5rem; width:100%; padding:0.5rem; background: #ffd32a; color: #1e272e; border: none; font-weight: bold;">Book Highlighted Choice</button>
                    `;
                } else {
                    suggestionHtml = `
                        <div class="brand-icon" style="background:rgba(30, 144, 255, 0.1); color:var(--accent); margin-bottom:1rem; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">📍</div>
                        <h4 style="margin: 0.5rem 0; color:var(--text-secondary);">No nearby parking found</h4>
                        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">We couldn't find any parking slots within 5km of your current location.</p>
                        <button class="btn btn-secondary" onclick="window.location.hash='#/map'" style="width:100%; padding:0.5rem; border: 1px dashed var(--accent); color: var(--accent);">🔍 Explore All Locations on Map</button>
                    `;
                }

                activeBookingsHtml = `
                    <div style="display:flex; gap:1rem; flex-direction:column;">
                        <div class="card glass-panel metric-card">
                            <div style="display:flex; justify-content: space-between; align-items: start;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Active Sessions</span>
                                <div class="brand-icon">${icons.car}</div>
                            </div>
                            <div class="metric-v" style="margin: 1rem 0;">None</div>
                            <span style="color: var(--success); font-size: 0.875rem;">Ready to park</span>
                        </div>
                        ${suggestionHtml ? `<div class="card glass-panel metric-card" style="border-color:rgba(30,144,255,0.3); box-shadow:0 0 15px rgba(30,144,255,0.1);">${suggestionHtml}</div>` : ''}
                    </div>
                `;
            }

            // Booking & Payment History Table
            let historyHtml = '';
            if (pastBookings.length > 0) {
                const historyRows = pastBookings.map(b => `
                    <tr>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-family: monospace;">${b.id.slice(0,8)}</td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.locName}</td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Slot #${b.slotId}</td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">${b.vehicleNo || 'Any'} (${b.vehicleType || 'Any'})</td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">₹${b.totalPrice.toLocaleString('en-IN')}</td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">
                            ${b.cancelled ? '<span style="color: var(--error);">Cancelled</span>' : '<span style="color: var(--text-muted);">Completed</span>'}
                        </td>
                        <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-size: 0.85rem; color: var(--success);">
                            ${b.refundStatus || (b.cancelled ? 'No Refund' : '-')}
                        </td>
                    </tr>
                `).join('');

                historyHtml = `
                    <div class="card glass-panel animate-slide-up delay-200" style="margin-top: 2rem;">
                        <h3>Booking & Payment History</h3>
                        <div style="overflow-x: auto; margin-top: 1rem;">
                            <table style="width: 100%; text-align: left; border-collapse: collapse;">
                                <thead>
                                    <tr style="color: var(--text-secondary);">
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Ref ID</th>
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Location</th>
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Slot</th>
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Paid</th>
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Status</th>
                                        <th style="padding: 1rem; border-bottom: 1px solid var(--border-color);">Refund</th>
                                    </tr>
                                </thead>
                                <tbody>${historyRows}</tbody>
                            </table>
                        </div>
                    </div>
                `;
            }

            return `
            <div class="dashboard-page animate-fade-in" style="max-width: 1000px;">
                <div class="dashboard-header animate-slide-up">
                    <div>
                        <h2>Hello, ${user.name} 👋</h2>
                        <p style="color: var(--text-secondary);">Here is your parking status and history.</p>
                    </div>
                </div>

                <div class="dash-grid animate-slide-up delay-100" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start;">
                    <div>
                        <h3 style="margin-bottom: 1rem;">Current Active Bookings</h3>
                        ${activeBookingsHtml}
                    </div>

                    <div>
                        <h3 style="margin-bottom: 1rem;">Account Overview</h3>
                        <div class="card glass-panel action-card" style="margin-bottom: 1rem;">
                            <div class="action-icon">${icons.clock}</div>
                            <h4>Total Past Bookings</h4>
                            <p style="color: var(--text-secondary); font-size: 1.2rem; margin-top: 0.5rem; font-weight: bold;">${pastBookings.length}</p>
                        </div>
                        <div class="card glass-panel action-card">
                            <div class="action-icon">${icons.mapPin}</div>
                            <h4>Find New Parking</h4>
                            <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">Ready to park again? Navigate to Map View.</p>
                            <button class="btn btn-primary" data-link="/map" style="margin-top: 1rem; width: 100%;">View Map</button>
                        </div>
                    </div>
                </div>

                ${historyHtml}
            </div>
            `;
        },

        map: () => `
            <div class="map-page animate-fade-in" style="position: relative;">
                <div id="map-search-bar" style="position: absolute; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 1000; width: 90%; max-width: 600px; display: flex; flex-direction: column; background: rgba(15, 23, 42, 0.9); padding: 1rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(10px); border: 1px solid var(--border-color);">
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" id="map-search-name" class="form-control" placeholder="Search location name..." style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; flex: 3; height: 40px;">
                        <button class="btn btn-secondary" id="map-filter-toggle" style="flex: 1; height: 40px; padding: 0.25rem;">⚙️ Filters</button>
                    </div>
                    <div id="map-filters" style="display: none; flex-direction: column; gap: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="color: var(--text-secondary); font-size: 0.85rem; width: 140px;">Max Price: ₹<span id="price-val">500</span></label>
                            <input type="range" id="filter-price" min="10" max="500" step="10" value="500" style="flex: 1;">
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="color: var(--text-secondary); font-size: 0.85rem; width: 140px;">Max Distance: <span id="dist-val">5</span> km</label>
                            <input type="range" id="filter-dist" min="1" max="15" step="1" value="5" style="flex: 1;">
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="color: var(--text-secondary); font-size: 0.85rem; width: 140px;">Min Available Slots:</label>
                            <input type="number" id="filter-slots" min="0" max="50" value="0" class="form-control" style="width: 80px; padding: 0.25rem 0.5rem; height: auto; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white;">
                        </div>
                    </div>
                </div>
                <div id="map-container"></div>
                <button class="location-btn" id="find-me-btn" title="Find My Location" style="z-index: 1000;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                </button>
            </div>
        `,

        parkingDetails: (id) => {
            const loc = Database.getLocation(id);
            if (!loc) return '<div class="dashboard-page animate-fade-in"><h2>Location not found</h2><button class="btn btn-primary" data-link="/map" style="margin-top: 1rem;">Back to Map</button></div>';

            const slotsHtml = loc.slots.map(s => {
                return `<div class="slot slot-${s.status}" data-slot-id="${s.id}" data-loc-id="${loc.id}">
                    ${s.id}
                </div>`;
            }).join('');

            const availableCount = loc.slots.filter(s => s.status === 'available').length;

            return `
            <div class="dashboard-page animate-fade-in" style="max-width: 800px;">
                <button class="btn btn-secondary" style="margin-bottom: 2rem;" data-link="/map">← Back to Map</button>
                
                <div class="card glass-panel" style="margin-bottom: 2rem;">
                    <h2>${loc.name}</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 1rem;">₹${loc.price.toLocaleString('en-IN')}/hour • ${availableCount}/${loc.totalSlots} Slots Available</p>
                    
                    <div style="display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap;">
                        <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 15px; height: 15px; background: rgba(46, 213, 115, 0.2); border: 2px solid var(--success); border-radius: 4px;"></div> Available</span>
                        <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 15px; height: 15px; background: rgba(254, 202, 87, 0.2); border: 2px solid #feca57; border-radius: 4px;"></div> Reserved</span>
                        <span style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;"><div style="width: 15px; height: 15px; background: rgba(255, 71, 87, 0.2); border: 2px solid var(--error); border-radius: 4px;"></div> Occupied</span>
                    </div>

                    <div class="slots-grid">
                        ${slotsHtml}
                    </div>
                </div>
            </div>
            `;
        },

        profile: () => {
            const user = Auth.getUser();
            const bookings = Database.getBookings(user.id);
            const totalSpent = bookings.reduce((sum, b) => sum + b.totalPrice, 0);
            
            return `
            <div class="dashboard-page animate-fade-in" style="max-width: 800px;">
                <div class="dashboard-header animate-slide-up">
                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                        <div style="width: 80px; height: 80px; background: var(--bg-surface); border: 2px solid var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: var(--accent);">
                            ${icons.user}
                        </div>
                        <div>
                            <h2>${user.name}'s Profile</h2>
                            <p style="color: var(--text-secondary);">Manage your personal information and preferences.</p>
                        </div>
                    </div>
                </div>

                <div class="dash-grid animate-slide-up delay-100" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));">
                    <div class="card glass-panel flex-1">
                        <h3 style="margin-bottom: 1.5rem;">Account Details</h3>
                        <form id="profile-form">
                            <div class="form-group">
                                <label class="form-label">Full Name</label>
                                <input type="text" id="profile-name" class="form-control" style="background:var(--bg-secondary); border-color:var(--border-color); color:white;" value="${user.name}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Email Address</label>
                                <input type="email" class="form-control" style="background:var(--bg-surface); border-color:var(--border-color); color:var(--text-muted);" value="${user.email}" disabled>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Phone Number</label>
                                <input type="tel" id="profile-phone" class="form-control" style="background:var(--bg-secondary); border-color:var(--border-color); color:white;" value="${user.phone || ''}" placeholder="Enter your phone number">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Update Password (optional)</label>
                                <input type="password" id="profile-password" class="form-control" style="background:var(--bg-secondary); border-color:var(--border-color); color:white;" placeholder="Leave blank to keep current">
                            </div>
                            <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Save Changes</button>
                            <div id="profile-msg" style="margin-top: 1rem; text-align: center; font-size: 0.875rem;"></div>
                        </form>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                        <div class="card glass-panel metric-card">
                            <span style="color: var(--text-secondary); font-weight: 500;">Account Created</span>
                            <div class="metric-v" style="font-size: 1.2rem; margin-top: 0.5rem; color: white;">
                                ${new Date(user.createdAt || Date.now()).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                        </div>
                        <div class="card glass-panel metric-card">
                            <span style="color: var(--text-secondary); font-weight: 500;">Total Bookings</span>
                            <div class="metric-v" style="font-size: 2rem; color: var(--accent);">${bookings.length}</div>
                        </div>
                        <div class="card glass-panel metric-card">
                            <span style="color: var(--text-secondary); font-weight: 500;">Total Amount Spent</span>
                            <div class="metric-v" style="font-size: 2rem; color: var(--accent);">₹${totalSpent.toLocaleString('en-IN')}</div>
                        </div>
                    </div>
                </div>
            </div>`;
        }
    };

    // --- Router ---
    const router = async () => {
        let path = window.location.hash.slice(1).toLowerCase() || '/';
        renderNavbar();

        // Protected Routes
        if ((path === '/dashboard' || path === '/profile' || path === '/admin' || path === '/map' || path.startsWith('/parking/')) && !Auth.isAuthenticated()) {
            return navigateTo('/login');
        }

        if (path === '/admin' && Auth.isAuthenticated()) {
            const user = Auth.getUser();
            if (user.role !== 'admin') {
                showNotification("Access Denied: Administrator privileges required.", "error");
                return navigateTo('/map');
            }
        }

        // Public Only Routes (redirect to map if logged in)
        if ((path === '/login' || path === '/admin-login' || path === '/register' || path === '/') && Auth.isAuthenticated()) {
             const user = Auth.getUser();
             return navigateTo(user && user.role === 'admin' ? '/admin' : '/map');
        }

        if (path.startsWith('/parking/')) {
            const id = path.split('/')[2];
            container.innerHTML = Views.parkingDetails(id);
            attachParkingHandlers();
            return;
        }

        switch (path) {
            case '/':
                container.innerHTML = Views.landing();
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) entry.target.classList.add('show');
                    });
                }, { threshold: 0.1 });
                document.querySelectorAll('.scroll-animate').forEach(el => observer.observe(el));
                break;
            case '/login':
                container.innerHTML = Views.login();
                attachLoginForm();
                break;
            case '/admin-login':
                container.innerHTML = Views.adminLogin();
                attachAdminLoginForm();
                break;
            case '/register':
                container.innerHTML = Views.register();
                attachRegisterForm();
                break;
            case '/dashboard':
                container.innerHTML = Views.dashboard();
                attachDashboardHandlers();
                break;
            case '/profile':
                container.innerHTML = Views.profile();
                attachProfileHandlers();
                break;
            case '/admin':
                container.innerHTML = Views.adminDashboard();
                attachAdminHandlers();
                break;
            case '/map':
                container.innerHTML = Views.map();
                initMap();
                break;
            default:
                container.innerHTML = '<h1 style="text-align:center; padding: 4rem;">404 - Page Not Found</h1>';
        }
    };

    const navigateTo = (url) => {
        window.location.hash = url;
    };

    const renderNavbar = () => {
        if (Auth.isAuthenticated()) {
            const user = Auth.getUser();
            const adminLink = user && user.role === 'admin' ? `<a class="nav-item" data-link="/admin">Admin Panel</a>` : '';
            navLinks.innerHTML = `
                <a class="nav-item" data-link="/map">Map</a>
                <a class="nav-item" data-link="/dashboard">Dashboard</a>
                <a class="nav-item" data-link="/profile">Profile</a>
                ${adminLink}
                <a class="nav-item" id="logout-btn">Logout</a>
            `;
            document.getElementById('logout-btn').addEventListener('click', (e) => {
                e.preventDefault();
                Auth.logout();
                navigateTo('/');
            });
        } else {
            navLinks.innerHTML = `
                <a class="nav-item" data-link="/login">User Login</a>
                <a class="nav-item" data-link="/admin-login" style="color: var(--error);">Admin Login</a>
                <button class="btn btn-primary" data-link="/register" style="padding: 0.5rem 1rem;">Sign Up</button>
            `;
        }
    };

    // --- Map Logic ---
    let mapInstance = null;
    let markersGroup = null;
    let lastKnownLat = 40.7128;
    let lastKnownLng = -74.0060;
    let userLocationEnabled = false;

    const initMap = () => {
        if (mapInstance) {
            mapInstance.remove();
        }

        const defaultLocation = [40.7128, -74.0060];
        
        mapInstance = L.map('map-container', {
            zoomControl: false
        }).setView(defaultLocation, 14);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(mapInstance);

        L.control.zoom({ position: 'topright' }).addTo(mapInstance);

        const btn = document.getElementById('find-me-btn');
        if (btn) btn.addEventListener('click', locateUser);

        // Filter Handlers
        const sName = document.getElementById('map-search-name');
        const fToggle = document.getElementById('map-filter-toggle');
        const fPrice = document.getElementById('filter-price');
        const fDist = document.getElementById('filter-dist');
        const fSlots = document.getElementById('filter-slots');

        const triggerRender = () => { generateMockParkingSpots(lastKnownLat, lastKnownLng); };

        if (fToggle) {
            fToggle.addEventListener('click', () => {
                const fs = document.getElementById('map-filters');
                fs.style.display = fs.style.display === 'none' ? 'flex' : 'none';
            });
        }
        if (sName) sName.addEventListener('input', triggerRender);
        if (fPrice) fPrice.addEventListener('input', (e) => { document.getElementById('price-val').textContent = e.target.value; triggerRender(); });
        if (fDist) fDist.addEventListener('input', (e) => { document.getElementById('dist-val').textContent = e.target.value; triggerRender(); });
        if (fSlots) fSlots.addEventListener('input', triggerRender);

        locateUser(); 
    };

    const locateUser = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocationEnabled = true;
                    lastKnownLat = position.coords.latitude;
                    lastKnownLng = position.coords.longitude;
                    
                    mapInstance.setView([lastKnownLat, lastKnownLng], 15);
                    
                    L.circleMarker([lastKnownLat, lastKnownLng], {
                        radius: 8,
                        fillColor: "var(--accent)",
                        color: "#fff",
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).addTo(mapInstance)
                      .bindPopup("<b>You are here</b>")
                      .openPopup();

                    generateMockParkingSpots(lastKnownLat, lastKnownLng);
                },
                (error) => {
                    console.log("Geolocation error:", error);
                    userLocationEnabled = false;
                    showNotification("Location permissions denied. Fallback to default area.", "warning");
                    generateMockParkingSpots(lastKnownLat, lastKnownLng);
                }
            );
        } else {
            userLocationEnabled = false;
            showNotification("Geolocation not supported by this browser.", "warning");
            generateMockParkingSpots(lastKnownLat, lastKnownLng);
        }
    };

    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return (R * c).toFixed(2);
    };

    const getBestRecommendation = (lat, lng) => {
        const locations = Database.getLocations(lat, lng);
        let bestScore = Infinity;
        let bestLoc = null;
        let bestDist = 0;

        locations.forEach(spot => {
            const dist = typeof userLocationEnabled !== 'undefined' && userLocationEnabled ? 
                        parseFloat(getDistanceFromLatLonInKm(lat, lng, spot.lat, spot.lng)) : 1;
            const availableCount = spot.slots.filter(s => s.status === 'available').length;
            if (availableCount > 0 && dist <= 5) {
                const score = (dist * 20) + (spot.price * 0.2) - (availableCount * 5);
                if (score < bestScore) { bestScore = score; bestLoc = spot; bestDist = dist; }
            }
        });
        return { bestLoc, bestDist };
    };

    const generateMockParkingSpots = (lat, lng) => {
        if (markersGroup) {
            markersGroup.clearLayers();
        } else {
            markersGroup = L.layerGroup().addTo(mapInstance);
        }

        let locations = Database.getLocations(lat, lng);

        // Apply UI Filters
        const sName = document.getElementById('map-search-name');
        if (sName) {
            const query = sName.value.toLowerCase();
            const maxPrice = parseFloat(document.getElementById('filter-price').value || 500);
            const maxDist = parseFloat(document.getElementById('filter-dist').value || 50);
            const minSlots = parseInt(document.getElementById('filter-slots').value || 0);

            locations = locations.filter(spot => {
                const availableCount = spot.slots.filter(s => s.status === 'available').length;
                const dist = parseFloat(getDistanceFromLatLonInKm(lat, lng, spot.lat, spot.lng));
                
                return spot.name.toLowerCase().includes(query) && 
                       spot.price <= maxPrice && 
                       dist <= maxDist && 
                       availableCount >= minSlots;
            });
        }

        const { bestLoc } = getBestRecommendation(lat, lng);
        
        locations.forEach(spot => {
            const dist = getDistanceFromLatLonInKm(lat, lng, spot.lat, spot.lng);
            const distDisplay = userLocationEnabled ? dist + " km" : "Unknown (Location Off)";
            const availableCount = spot.slots.filter(s => s.status === 'available').length;
            const isBest = bestLoc && bestLoc.id === spot.id;
            
            const popupContent = `
                <div class="parking-popup">
                    ${isBest ? `<div style="background: #ffd32a; color: #1e272e; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-block; margin-bottom: 0.5rem;">⭐ BEST PARKING NEAR YOU</div>` : ''}
                    <h4>${spot.name}</h4>
                    <p>📍 Distance: ${distDisplay}</p>
                    <p style="color: var(--text-secondary); font-size: 0.875rem;">💰 Price: ₹${spot.price.toLocaleString('en-IN')}/hr</p>
                    <span class="badge-slots">${availableCount} / ${spot.totalSlots} slots available</span>
                    <button class="btn btn-primary" style="margin-top: 15px; width: 100%; padding: 8px; font-size: 0.85rem; ${isBest ? 'background: #ffd32a; color: #1e272e; border: none;' : ''}" onclick="window.location.hash = '/parking/${spot.id}'">${isBest ? 'Book Recommended Slot' : 'View Layout'}</button>
                </div>
            `;

            const icon = L.divIcon({
                className: 'custom-pin',
                html: `
                    <div style="background: ${isBest ? '#ffd32a' : 'var(--bg-surface)'}; border: 2px solid ${isBest ? '#ffa801' : 'var(--accent)'}; color: ${isBest ? '#1e272e' : 'var(--accent)'}; padding: 5px 10px; border-radius: 20px; font-weight: bold; white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                        ${isBest ? '⭐ ' : ''}${availableCount} <small>slots</small>
                    </div>`
            });

            L.marker([spot.lat, spot.lng], { icon, zIndexOffset: isBest ? 1000 : 0 }).addTo(markersGroup).bindPopup(popupContent);
        });
    };

    // --- Form Handlers ---

    const openBookingModal = (locId, slotId) => {
        const loc = Database.getLocation(locId);
        const user = Auth.getUser();
        if (!user) {
            alert('Please login to book a spot!');
            navigateTo('/login');
            return;
        }

        const exactSlot = loc.slots.find(s=>s.id === slotId);
        if (exactSlot.status !== 'available') {
            alert('This slot is already booked or reserved.');
            return;
        }

        // Lock slot as RESERVED immediately upon initiating checkout matching 3 mins
        const holdDuration = 3 * 60 * 1000;
        const heldUntil = Date.now() + holdDuration;
        Database.updateSlot(locId, slotId, 'reserved', heldUntil);

        const modalHtml = `
        <div class="modal-overlay active" id="booking-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="color: var(--accent);">Complete Reservation</h3>
                    <button class="modal-close" id="close-modal">&times;</button>
                </div>
                <div style="background: rgba(255, 168, 1, 0.1); border-left: 4px solid #ffa801; padding: 0.75rem; margin-bottom: 1rem; border-radius: 4px;">
                    <span style="color: #ffa801; font-weight: bold; font-size: 0.85rem; display: block; margin-bottom: 0.25rem;">Slot Temporarily Held</span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">This spot is locked for you. Releasing in <strong id="hold-timer" style="color: white; font-family: monospace; font-size: 1rem;">03:00</strong> mins.</span>
                </div>
                <p style="margin-bottom: 0.5rem; color: var(--text-secondary);">Location: <strong style="color:white;">${loc.name}</strong></p>
                <p style="margin-bottom: 1.5rem; color: var(--text-secondary);">Slot Number: <strong style="color:white;">#${slotId}</strong></p>
                
                <form id="booking-form">
                    <div class="form-group">
                        <label class="form-label">Vehicle Number</label>
                        <input type="text" id="vehicle-no" class="form-control" required placeholder="e.g. MH12 AB 1234" style="background: var(--bg-secondary); border-color: var(--border-color); color: white; text-transform: uppercase;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Vehicle Type</label>
                        <select id="vehicle-type" class="form-control" required style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                            <option value="Car" selected>Car</option>
                            <option value="Bike">Bike / Scooter</option>
                            <option value="Van">Van / LCV</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Duration</label>
                        <select id="duration" class="form-control" required style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                            <option value="0.016666">1 Minute (Test Expiry)</option>
                            <option value="1" selected>1 Hour (₹${(loc.price).toLocaleString('en-IN')})</option>
                            <option value="2">2 Hours (₹${(loc.price * 2).toLocaleString('en-IN')})</option>
                            <option value="3">3 Hours (₹${(loc.price * 3).toLocaleString('en-IN')})</option>
                            <option value="4">4 Hours (₹${(loc.price * 4).toLocaleString('en-IN')})</option>
                        </select>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; margin-bottom: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                        <span style="color: var(--text-secondary);">Total</span>
                        <span id="total-price" style="font-size: 1.5rem; font-weight: 700;">₹${loc.price.toLocaleString('en-IN')}</span>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">Confirm Booking</button>
                    <div id="booking-error" class="error-msg" style="margin-top: 1rem;"></div>
                </form>
            </div>
        </div>
        `;

        const existing = document.getElementById('booking-modal');
        if (existing) existing.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        let holdInterval;
        const closeBookingModal = () => {
            if (holdInterval) clearInterval(holdInterval);
            Database.updateSlot(locId, slotId, 'available');
            const mod = document.getElementById('booking-modal');
            if(mod) mod.remove();
        };

        document.getElementById('close-modal').addEventListener('click', closeBookingModal);

        holdInterval = setInterval(() => {
            const timeLeft = heldUntil - Date.now();
            if (timeLeft <= 0) {
                closeBookingModal();
                showNotification('Slot hold expired. Please try booking again.', 'error');
                router(); 
            } else {
                const timerEl = document.getElementById('hold-timer');
                if (timerEl) {
                    const mins = Math.floor(timeLeft / 60000);
                    const secs = Math.floor((timeLeft % 60000) / 1000);
                    timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                }
            }
        }, 1000);

        document.getElementById('duration').addEventListener('change', (e) => {
            const hrs = parseFloat(e.target.value);
            document.getElementById('total-price').textContent = '₹' + (loc.price * (hrs < 1 ? 0 : hrs)).toLocaleString('en-IN');
        });

        let savedVehNo = '';
        let savedVehType = '';
        let savedHrs = 1;

        document.getElementById('booking-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            savedHrs = parseFloat(document.getElementById('duration').value);
            savedVehNo = document.getElementById('vehicle-no').value;
            savedVehType = document.getElementById('vehicle-type').value;
            
            btn.textContent = 'Preparing checkout...';
            btn.disabled = true;

            if (holdInterval) clearInterval(holdInterval);

            setTimeout(() => {
                const mod = document.getElementById('booking-modal');
                if(mod) mod.remove();
                
                // Show Payment Modal
                const totalPrice = (loc.price * (savedHrs < 1 ? 0 : savedHrs)).toLocaleString('en-IN');
                const paymentModalHtml = `
                <div class="modal-overlay active" id="payment-modal">
                    <div class="modal-content" style="max-width: 450px;">
                        <div class="modal-header">
                            <h3>Secure Checkout</h3>
                            <button class="modal-close" id="close-payment">&times;</button>
                        </div>
                        
                        <div style="background: rgba(46, 213, 115, 0.1); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; text-align: center; border: 1px solid rgba(46, 213, 115, 0.3);">
                            <span style="color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">Total Amount Due</span>
                            <span style="font-size: 2rem; font-weight: bold; color: white;">₹${totalPrice}</span>
                        </div>

                        <!-- Mocked Stripe/Razorpay generic structure -->
                        <form id="payment-form">
                            <div class="form-group">
                                <label class="form-label">Cardholder Name</label>
                                <input type="text" class="form-control" required placeholder="John Doe" style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Card Number</label>
                                <input type="text" class="form-control" required placeholder="•••• •••• •••• ••••" pattern="[0-9]{16}" maxlength="16" style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                            </div>
                            <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
                                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                                    <label class="form-label">Expiry</label>
                                    <input type="text" class="form-control" required placeholder="MM/YY" maxlength="5" style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                                </div>
                                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                                    <label class="form-label">CVC</label>
                                    <input type="password" class="form-control" required placeholder="•••" maxlength="3" style="background: var(--bg-secondary); border-color: var(--border-color); color: white;">
                                </div>
                            </div>
                            
                            <button type="submit" class="btn btn-primary" style="width: 100%;" id="pay-btn">Pay ₹${totalPrice}</button>
                            <div id="payment-error" class="error-msg" style="margin-top: 1rem; text-align: center;"></div>
                            
                            <p style="text-align: center; font-size: 0.75rem; color: var(--text-muted); margin-top: 1rem;">
                                🔒 Payments are simulated for testing purposes.
                            </p>
                        </form>
                    </div>
                </div>
                `;
                
                document.body.insertAdjacentHTML('beforeend', paymentModalHtml);

                document.getElementById('close-payment').addEventListener('click', () => {
                    Database.updateSlot(locId, slotId, 'available');
                    document.getElementById('payment-modal').remove();
                });

                document.getElementById('payment-form').addEventListener('submit', (evt) => {
                    evt.preventDefault();
                    const payBtn = document.getElementById('pay-btn');
                    payBtn.textContent = 'Processing Payment...';
                    payBtn.disabled = true;

                    // Simulate Payment Gateway processing delay
                    setTimeout(() => {
                        try {
                            Database.createBooking(user.id, locId, slotId, savedHrs, loc.price, savedVehNo, savedVehType);
                            document.getElementById('payment-modal').remove();
                            
                            showNotification(`Booking Confirmed! Your Entry QR Code is generated in Dashboard.`, 'success');
                            navigateTo('/dashboard');
                        } catch(error) {
                            const pErr = document.getElementById('payment-error');
                            pErr.textContent = error.message;
                            pErr.style.display = 'block';
                            payBtn.textContent = `Pay ₹${totalPrice}`;
                            payBtn.disabled = false;
                        }
                    }, 1500); // Payment Gateways take a bit longer usually
                });

            }, 300);
        });
    };

    const attachParkingHandlers = () => {
        const user = Auth.getUser();
        const isAdmin = user && user.role === 'admin';
        const slots = document.querySelectorAll('.slot');
        slots.forEach(slot => {
            // Admin can click any slot despite CSS pointer-events
            if (isAdmin) {
                slot.style.cursor = 'pointer';
                slot.style.opacity = '1';
            }

            slot.addEventListener('click', (e) => {
                const locId = e.target.getAttribute('data-loc-id');
                const slotId = parseInt(e.target.getAttribute('data-slot-id'));

                if (isAdmin) {
                    const action = prompt(`Admin Action for Slot #${slotId}:\nType 'available', 'reserved', or 'occupied' to set status.`, 'available');
                    if (['available', 'reserved', 'occupied'].includes(action)) {
                        Database.updateSlot(locId, slotId, action);
                        window.dispatchEvent(new Event('syncEvent'));
                        pushSync();
                        router();
                    }
                    return;
                }

                if (e.target.classList.contains('slot-available')) {
                    openBookingModal(locId, slotId);
                }
            });
        });
    };

    const attachDashboardHandlers = () => {
        const cancelBtns = document.querySelectorAll('.cancel-booking-btn');
        cancelBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (confirm('Are you sure you want to cancel this booking? This will instantly free the slot for others.')) {
                    const bId = e.target.getAttribute('data-booking-id');
                    const refSt = Database.cancelBooking(bId);
                    showNotification('Booking Cancelled. ' + (refSt || ''), 'warning');
                    router(); // refresh view
                }
            });
        });

        const checkinBtns = document.querySelectorAll('.checkin-btn');
        checkinBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bId = e.target.getAttribute('data-booking-id');
                const lat = parseFloat(e.target.getAttribute('data-lat'));
                const lng = parseFloat(e.target.getAttribute('data-lng'));
                
                if (typeof userLocationEnabled !== 'undefined' && userLocationEnabled && lastKnownLat && lastKnownLng) {
                    const distKm = parseFloat(getDistanceFromLatLonInKm(lastKnownLat, lastKnownLng, lat, lng));
                    if (distKm > 0.5) { // Needs to be within 500 meters
                        showNotification('You are too far away to Check-In. Please arrive at the location first. (Distance: ' + distKm + 'km)', 'error');
                        return;
                    } 
                }

                if (confirm('Verify Check-In: Are you parked inside the slot?')) {
                    Database.checkInBooking(bId);
                    showNotification('Successfully Checked In! Your spot is secured.', 'success');
                    router();
                }
            });
        });

        const checkoutBtns = document.querySelectorAll('.checkout-btn');
        checkoutBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (confirm('Are you sure you want to check out? Your session will end and the slot will be released.')) {
                    const bId = e.target.getAttribute('data-booking-id');
                    Database.checkOutBooking(bId);
                    showNotification('Successfully Checked Out. Safe travels!', 'success');
                    router();
                }
            });
        });
    };

    const attachAdminHandlers = () => {
        const btn = document.getElementById('add-location-btn');
        if (!btn) return;
        
        btn.addEventListener('click', () => {
            const modalHtml = `
            <div class="modal-overlay active" id="add-loc-modal">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3>Add New Location</h3>
                        <button class="modal-close" id="close-add-loc">&times;</button>
                    </div>
                    <div id="admin-map" style="height: 250px; border-radius: 8px; margin-bottom: 1rem;"></div>
                    <form id="add-loc-form">
                        <div class="form-group">
                            <label class="form-label">Location Name</label>
                            <input type="text" id="loc-name" class="form-control" required style="background:var(--bg-secondary); border:1px solid var(--border-color); color:white;">
                        </div>
                        <div style="display:flex; gap:1rem;">
                            <div class="form-group" style="flex:1;">
                                <label class="form-label">Number of Slots</label>
                                <input type="number" id="loc-slots" class="form-control" required min="1" max="100" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:white;">
                            </div>
                            <div class="form-group" style="flex:1;">
                                <label class="form-label">Price Per Hour (₹)</label>
                                <input type="number" id="loc-price" class="form-control" required min="0" step="0.5" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:white;">
                            </div>
                        </div>
                        <input type="hidden" id="loc-lat">
                        <input type="hidden" id="loc-lng">
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Create Location</button>
                        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem; text-align:center;">Drag pin to set location</p>
                    </form>
                </div>
            </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHtml);

            document.getElementById('close-add-loc').addEventListener('click', () => {
                document.getElementById('add-loc-modal').remove();
            });

            // Initialize admin map
            setTimeout(() => {
                const adminMap = L.map('admin-map').setView([lastKnownLat, lastKnownLng], 14);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; CARTO'
                }).addTo(adminMap);
                
                let marker = L.marker([lastKnownLat, lastKnownLng], { draggable: true }).addTo(adminMap);
                document.getElementById('loc-lat').value = lastKnownLat;
                document.getElementById('loc-lng').value = lastKnownLng;

                adminMap.on('click', function(e) {
                    marker.setLatLng(e.latlng);
                    document.getElementById('loc-lat').value = e.latlng.lat;
                    document.getElementById('loc-lng').value = e.latlng.lng;
                });

                marker.on('dragend', function(e) {
                    const pos = marker.getLatLng();
                    document.getElementById('loc-lat').value = pos.lat;
                    document.getElementById('loc-lng').value = pos.lng;
                });
            }, 100);

            document.getElementById('add-loc-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const name = document.getElementById('loc-name').value;
                const slotsCount = parseInt(document.getElementById('loc-slots').value);
                const price = parseFloat(document.getElementById('loc-price').value);
                const lat = parseFloat(document.getElementById('loc-lat').value);
                const lng = parseFloat(document.getElementById('loc-lng').value);

                const locs = JSON.parse(localStorage.getItem('smartpark_locations') || '[]');
                const slots = [];
                for(let i=1; i<=slotsCount; i++) {
                    slots.push({ id: i, status: 'available' });
                }

                locs.push({
                    id: 'loc-' + Date.now(),
                    name, lat, lng, price, totalSlots: slotsCount, slots
                });

                localStorage.setItem('smartpark_locations', JSON.stringify(locs));
                window.dispatchEvent(new Event('syncEvent'));
                pushSync();
                
                document.getElementById('add-loc-modal').remove();
                router();
            });
        });

        // Initialize Chart
        setTimeout(() => {
            const ctx = document.getElementById('admin-chart');
            if (ctx && window.Chart && window.adminMetricsData) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: window.adminMetricsData.chartLabels,
                        datasets: [{
                            label: 'Daily Revenue (₹)',
                            data: window.adminMetricsData.revData,
                            borderColor: '#2ed573',
                            backgroundColor: 'rgba(46, 213, 115, 0.2)',
                            fill: true,
                            tension: 0.4
                        }, {
                            label: 'Total Bookings',
                            data: window.adminMetricsData.countsData,
                            borderColor: '#1e90ff',
                            backgroundColor: 'rgba(30, 144, 255, 0.2)',
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: 'white' } } },
                        scales: {
                            y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'white' } },
                            x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'white' } }
                        }
                    }
                });
            }
        }, 300);
    };

    const attachLoginForm = () => {
        const form = document.getElementById('login-form');
        const errDiv = document.getElementById('login-error');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const btn = form.querySelector('button');
                
                try {
                    btn.textContent = 'Logging in...';
                    btn.disabled = true;
                    await Auth.login(email, password);
                    navigateTo('/dashboard');
                } catch (error) {
                    errDiv.textContent = error.message;
                    errDiv.style.display = 'block';
                    btn.textContent = 'Login';
                    btn.disabled = false;
                }
            });
        }
    };

    const attachAdminLoginForm = () => {
        const form = document.getElementById('admin-login-form');
        const errDiv = document.getElementById('admin-login-error');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('admin-email').value;
                const password = document.getElementById('admin-password').value;
                const btn = form.querySelector('button');
                
                try {
                    btn.textContent = 'Authenticating...';
                    btn.disabled = true;
                    await Auth.adminLogin(email, password);
                    navigateTo('/admin');
                } catch (error) {
                    errDiv.textContent = error.message;
                    errDiv.style.display = 'block';
                    btn.textContent = 'Secure Login';
                    btn.disabled = false;
                }
            });
        }
    };

    const attachRegisterForm = () => {
        const form = document.getElementById('register-form');
        const errDiv = document.getElementById('register-error');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('name').value;
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const btn = form.querySelector('button');
                
                try {
                    btn.textContent = 'Creating...';
                    btn.disabled = true;
                    await Auth.register(name, email, password);
                    navigateTo('/dashboard');
                } catch (error) {
                    errDiv.textContent = error.message;
                    errDiv.style.display = 'block';
                    btn.textContent = 'Create Account';
                    btn.disabled = false;
                }
            });
        }
    };

    const attachProfileHandlers = () => {
        const form = document.getElementById('profile-form');
        const msgDiv = document.getElementById('profile-msg');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = form.querySelector('button');
                btn.textContent = 'Saving...';
                btn.disabled = true;

                const name = document.getElementById('profile-name').value;
                const phone = document.getElementById('profile-phone').value;
                const password = document.getElementById('profile-password').value;

                try {
                    const user = Auth.getUser();
                    await Auth.updateProfile(user.id, { name, phone, password });
                    
                    msgDiv.style.color = 'var(--success)';
                    msgDiv.textContent = 'Profile updated successfully!';
                    
                    // Trigger nav update
                    renderNavbar();
                    
                    setTimeout(() => {
                        msgDiv.textContent = '';
                        // Clear password field
                        document.getElementById('profile-password').value = '';
                    }, 3000);
                } catch (err) {
                    msgDiv.style.color = 'var(--error)';
                    msgDiv.textContent = 'Failed to update profile: ' + err.message;
                } finally {
                    btn.textContent = 'Save Changes';
                    btn.disabled = false;
                }
            });
        }
    };

    // Global Click Delegation for navigation
    document.body.addEventListener('click', e => {
        // If cliked element or its parent has data-link
        const target = e.target.closest('[data-link]');
        if (target) {
            e.preventDefault();
            navigateTo(target.getAttribute('data-link'));
        }
    });

    window.addEventListener('hashchange', router);
    window.addEventListener('authStateChanged', router);

    // Global Timer
    setInterval(() => {
        Database.cleanExpiredBookings();
        
        const timerEls = document.querySelectorAll('.active-timer');
        timerEls.forEach(timerEl => {
            const expiresAt = parseInt(timerEl.getAttribute('data-expires'));
            const now = Date.now();
            const diff = expiresAt - now;
            
            if (diff > 0) {
                const hrs = Math.floor(diff / (1000 * 60 * 60));
                const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const secs = Math.floor((diff % (1000 * 60)) / 1000);
                
                timerEl.textContent = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} remaining`;
                
                if (diff < 5 * 60 * 1000) {
                    timerEl.style.color = 'var(--error)';
                    timerEl.textContent = "⚠️ " + timerEl.textContent;

                    // Fire notification exactly around 5 min or 1 min using diff
                    const bookingId = timerEl.getAttribute('data-booking-id');
                    if (!window.__notifiedBookings) window.__notifiedBookings = new Set();
                    
                    if (diff < 60000 && !window.__notifiedBookings.has(bookingId + '-1m')) {
                        window.__notifiedBookings.add(bookingId + '-1m');
                        showNotification(`Slot #${timerEl.getAttribute('data-slot-id')} expires in less than 1 min!`, 'error');
                    } else if (diff < 300000 && diff > 290000 && !window.__notifiedBookings.has(bookingId + '-5m')) {
                        window.__notifiedBookings.add(bookingId + '-5m');
                        showNotification(`Slot #${timerEl.getAttribute('data-slot-id')} expires in 5 minutes.`, 'warning');
                    }
                } else {
                    timerEl.style.color = 'var(--text-primary)';
                }
            } else {
                timerEl.textContent = "Processing Expiry...";
                timerEl.style.color = 'var(--text-muted)';
            }
        });
    }, 1000);

    window.addEventListener('syncEvent', () => {
        if (window.location.hash === '#/dashboard' || window.location.hash === '#/admin' || window.location.hash.startsWith('#/parking/')) {
            router();
        } else if (window.location.hash === '#/map' || window.location.hash === '' || window.location.hash === '#/') {
            if (mapInstance) {
                generateMockParkingSpots(lastKnownLat, lastKnownLng);
            }
        }
    });

    // Init
    return { init: router };
})();

// Start App when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
