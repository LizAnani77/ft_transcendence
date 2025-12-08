// backend/src/services/oauth42.ts

export interface OAuth42TokenResponse {
	access_token: string;
	token_type: string;
	scope?: string;
	created_at?: number;
	expires_in?: number;
	refresh_token?: string;
}

export interface OAuth42Profile {
	id: number;
	login: string;
	email?: string;
	first_name?: string;
	last_name?: string;
	image?: { link?: string };
}

export class OAuth42ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OAuth42ConfigError';
	}
}

export class OAuth42Service {
	private readonly clientId = process.env.OAUTH42_CLIENT_ID;
	private readonly clientSecret = process.env.OAUTH42_CLIENT_SECRET;
	private readonly redirectUri = process.env.OAUTH42_REDIRECT_URI;
	private readonly authUrl = process.env.OAUTH42_AUTH_URL;
	private readonly tokenUrl = process.env.OAUTH42_TOKEN_URL;
	private readonly apiBase = process.env.OAUTH42_API_BASE;

	public isConfigured(): boolean {
		return Boolean(this.clientId && this.clientSecret && this.redirectUri);
	}

	private ensureConfigured() {
		if (!this.isConfigured()) {
			throw new OAuth42ConfigError('OAuth 42 is not configured');
		}
	}

	public buildAuthorizeUrl(state: string): string {
		this.ensureConfigured();
		const url = new URL(this.authUrl);
		url.searchParams.set('client_id', this.clientId);
		url.searchParams.set('redirect_uri', this.redirectUri);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', 'public');
		url.searchParams.set('state', state);
		return url.toString();
	}

	public async exchangeCode(code: string): Promise<OAuth42TokenResponse> {
		this.ensureConfigured();
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: this.clientId,
			client_secret: this.clientSecret,
			code,
			redirect_uri: this.redirectUri
		});

		const res = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`42 token exchange failed (${res.status}): ${text}`);
		}

		return await res.json() as OAuth42TokenResponse;
	}

	public async fetchProfile(accessToken: string): Promise<OAuth42Profile> {
		this.ensureConfigured();
		const res = await fetch(`${this.apiBase}/me`, {
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Accept': 'application/json'
			}
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`42 profile fetch failed (${res.status}): ${text}`);
		}

		return await res.json() as OAuth42Profile;
	}
}
