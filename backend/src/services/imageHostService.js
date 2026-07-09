import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Image Host Service with Session-Based Authentication
 * Uses login endpoint to get session cookie, then uses cookie for all requests
 */
class ImageHostService {
  constructor() {
    this.baseURL = process.env.IMAGE_HOST_API_URL;
    this.loginURL = process.env.IMAGE_HOST_LOGIN_URL || `${this.baseURL}/login`;
    this.sessionCookie = null;
    this.sessionExpiry = null;
    this.isLoggedIn = false;
    this.loginPromise = null;

    // Create axios instance with cookie support
    this.client = axios.create({
      baseURL: this.baseURL,
      withCredentials: true,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NoManenoBazaar/1.0',
      },
    });

    // Request interceptor to add session cookie
    this.client.interceptors.request.use(
      (config) => {
        if (this.sessionCookie) {
          config.headers.Cookie = this.sessionCookie;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor to handle session expiration
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          try {
            await this.login();
            return this.client(originalRequest);
          } catch (loginError) {
            console.error('Failed to refresh session:', loginError.message);
            return Promise.reject(error);
          }
        }
        
        return Promise.reject(error);
      }
    );
  }

  async login() {
    if (!this.hasCredentials()) {
      throw new Error('Image host credentials are not configured');
    }

    if (this.isSessionValid()) {
      return true;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = this._performLogin();
    try {
      const result = await this.loginPromise;
      return result;
    } finally {
      this.loginPromise = null;
    }
  }

  async _performLogin() {
    try {
      const username = process.env.IMAGE_HOST_USERNAME;
      const password = process.env.IMAGE_HOST_PASSWORD;

      if (!username || !password) {
        throw new Error('IMAGE_HOST_USERNAME and IMAGE_HOST_PASSWORD must be set in environment');
      }

      console.log('Logging into image host API...');

      const response = await axios.post(
        this.loginURL,
        {
          username: username,
          password: password,
        },
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const cookies = response.headers['set-cookie'];
      if (cookies && cookies.length > 0) {
        this.sessionCookie = cookies.join('; ');
        this.isLoggedIn = true;

        for (const cookie of cookies) {
          const maxAgeMatch = cookie.match(/Max-Age=(\d+)/);
          if (maxAgeMatch) {
            this.sessionExpiry = Date.now() + parseInt(maxAgeMatch[1]) * 1000;
            break;
          }
          const expiresMatch = cookie.match(/Expires=([^;]+)/);
          if (expiresMatch) {
            this.sessionExpiry = new Date(expiresMatch[1]).getTime();
            break;
          }
        }

        console.log('Image host login successful');
        return true;
      }

      throw new Error('No session cookie received from image host');
    } catch (error) {
      this.isLoggedIn = false;
      this.sessionCookie = null;
      this.sessionExpiry = null;
      
      console.error(`Image host login failed: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      
      throw new Error(`Image host authentication failed: ${error.message}`);
    }
  }

  isSessionValid() {
    if (!this.isLoggedIn || !this.sessionCookie) {
      return false;
    }
    
    if (this.sessionExpiry) {
      const bufferTime = 5 * 60 * 1000;
      if (Date.now() > (this.sessionExpiry - bufferTime)) {
        this.isLoggedIn = false;
        this.sessionCookie = null;
        return false;
      }
    }
    
    return true;
  }

  hasCredentials() {
    return Boolean(
      this.baseURL &&
      this.loginURL &&
      process.env.IMAGE_HOST_USERNAME &&
      process.env.IMAGE_HOST_PASSWORD
    );
  }

  async ensureSession() {
    if (!this.isSessionValid()) {
      await this.login();
    }
  }

  async uploadImage(file) {
    try {
      await this.ensureSession();

      const formData = new FormData();
      formData.append('image', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });

      if (process.env.IMAGE_HOST_UPLOAD_PRESET) {
        formData.append('preset', process.env.IMAGE_HOST_UPLOAD_PRESET);
      }
      if (process.env.IMAGE_HOST_FOLDER) {
        formData.append('folder', process.env.IMAGE_HOST_FOLDER);
      }

      const response = await this.client.post('/upload', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      const data = response.data;
      
      let url = data.url || data.secure_url || data.link || data.upload?.url;
      let publicId = data.id || data.public_id || data.image_id || data.upload?.id;

      if (!url && data.data) {
        url = data.data.url || data.data.secure_url || data.data.link;
        publicId = data.data.id || data.data.public_id || data.data.image_id;
      }

      if (!url && data.results && data.results.length > 0) {
        url = data.results[0].url || data.results[0].secure_url;
        publicId = data.results[0].id || data.results[0].public_id;
      }

      if (!url) {
        console.error('Unexpected response format:', JSON.stringify(data, null, 2));
        throw new Error('Could not extract image URL from response');
      }

      console.log(`Image uploaded successfully: ${publicId || 'unknown'}`);
      
      return { 
        url, 
        publicId: publicId || url.split('/').pop() || 'unknown' 
      };

    } catch (error) {
      console.error(`Image upload failed: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      throw new Error(`Image upload failed: ${error.message}`);
    }
  }

  async uploadMultipleImages(files) {
    if (!files || files.length === 0) {
      return [];
    }

    const uploadPromises = files.map(file => this.uploadImage(file));
    const results = await Promise.allSettled(uploadPromises);
    
    const successful = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    
    const failures = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    
    if (failures.length > 0) {
      console.warn(`${failures.length} image uploads failed`);
    }
    
    return successful;
  }

  async deleteImage(publicId) {
    try {
      await this.ensureSession();

      const response = await this.client.delete(`/images/${publicId}`, {
        data: { publicId },
      });

      console.log(`Image deleted: ${publicId}`);
      return { success: true, data: response.data };

    } catch (error) {
      if (error.response?.status === 404) {
        console.warn(`Image ${publicId} already deleted or not found`);
        return { success: true, alreadyDeleted: true };
      }
      
      console.error(`Failed to delete image ${publicId}: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      
      throw error;
    }
  }

  async deleteMultipleImages(publicIds) {
    const results = [];
    for (const publicId of publicIds) {
      try {
        await this.deleteImage(publicId);
        results.push({ success: true, publicId });
      } catch (error) {
        results.push({ success: false, publicId, error: error.message });
      }
    }
    return results;
  }

  getImageUrl(publicId, options = {}) {
    const { width, height, format, quality, crop } = options;
    let url = `${this.baseURL}/images/${publicId}`;
    
    const params = new URLSearchParams();
    if (width) params.append('w', width);
    if (height) params.append('h', height);
    if (format) params.append('format', format);
    if (quality) params.append('q', quality);
    if (crop) params.append('crop', crop);
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    return url;
  }

  async logout() {
    try {
      if (this.isSessionValid()) {
        await this.client.post('/logout');
      }
      this.sessionCookie = null;
      this.isLoggedIn = false;
      this.sessionExpiry = null;
      console.log('Image host logout successful');
    } catch (error) {
      console.error(`Image host logout failed: ${error.message}`);
      this.sessionCookie = null;
      this.isLoggedIn = false;
      this.sessionExpiry = null;
    }
  }

  isAuthenticated() {
    return this.isSessionValid();
  }

  getSessionStatus() {
    return {
      isLoggedIn: this.isLoggedIn,
      hasCookie: !!this.sessionCookie,
      sessionExpiry: this.sessionExpiry ? new Date(this.sessionExpiry).toISOString() : null,
      isValid: this.isSessionValid(),
    };
  }
}

const imageHostService = new ImageHostService();

const initializeImageHost = async () => {
  if (!imageHostService.hasCredentials()) {
    console.log('Image host credentials not configured; uploads will be disabled until credentials are added.');
    return;
  }

  try {
    await imageHostService.login();
    console.log('Image host service initialized successfully');
  } catch (error) {
    console.error('Image host initialization failed:', error.message);
  }
};

initializeImageHost();

const startSessionRefresh = () => {
  if (!imageHostService.hasCredentials()) {
    return;
  }

  const refreshInterval = parseInt(process.env.IMAGE_HOST_SESSION_REFRESH || '45');
  
  setInterval(async () => {
    try {
      if (!imageHostService.isSessionValid()) {
        console.log('Session expired, refreshing...');
        await imageHostService.login();
        console.log('Session refreshed successfully');
      }
    } catch (error) {
      console.error('Failed to refresh session:', error.message);
    }
  }, refreshInterval * 60 * 1000);
  
  console.log(`Session refresh scheduler started (every ${refreshInterval} minutes)`);
};

if (process.env.IMAGE_HOST_SESSION_REFRESH !== '0') {
  startSessionRefresh();
}

export default imageHostService;
