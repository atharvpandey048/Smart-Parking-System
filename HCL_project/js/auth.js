/**
 * Persistent Authentication Service
 * Uses Flask Backend with SQLite database for persistence.
 */
const Auth = {
    API_URL: 'http://localhost:8080/api',

    /**
     * Register a new user
     */
    async register(name, email, password) {
        try {
            const response = await fetch(`${this.API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Registration failed');
            
            this._setSession(data.token, data.user);
            return data;
        } catch (error) {
            console.error('Registration Error:', error);
            throw error;
        }
    },

    /**
     * Login existing user
     */
    async login(email, password) {
        try {
            const response = await fetch(`${this.API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login failed');
            
            this._setSession(data.token, data.user);
            return data;
        } catch (error) {
            console.error('Login Error:', error);
            throw error;
        }
    },

    /**
     * Dedicated Admin Login
     */
    async adminLogin(email, password) {
        try {
            const response = await fetch(`${this.API_URL}/admin-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Admin Portal: Authentication failed');
            
            this._setSession(data.token, data.user);
            return data;
        } catch (error) {
            console.error('Admin Login Error:', error);
            throw error;
        }
    },

    /**
     * Update User Profile in Database
     */
    async updateProfile(userId, data) {
        try {
            const response = await fetch(`${this.API_URL}/profile/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, ...data })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Update failed');
            
            // Re-store session with updated data
            this._setSession(localStorage.getItem('smartpark_token'), result.user);
            return result.user;
        } catch (error) {
            console.error('Profile Update Error:', error);
            throw error;
        }
    },

    /**
     * Logout
     */
    logout() {
        localStorage.removeItem('smartpark_token');
        localStorage.removeItem('smartpark_currentUser');
        window.dispatchEvent(new Event('authStateChanged'));
    },

    /**
     * Internal method to set local session
     */
    _setSession(token, user) {
        localStorage.setItem('smartpark_token', token);
        // Password is now handled server side, returning safe user object
        localStorage.setItem('smartpark_currentUser', JSON.stringify(user));
        window.dispatchEvent(new Event('authStateChanged'));
    },

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!localStorage.getItem('smartpark_token');
    },

    /**
     * Get current user details from local storage cache
     */
    getUser() {
        const userStr = localStorage.getItem('smartpark_currentUser');
        return userStr ? JSON.parse(userStr) : null;
    }
};

window.Auth = Auth;
