module.exports = {
  apps: [{
    name:         'media-search-bot',
    script:       'index.js',
    restart_delay: 3000,
    max_restarts:  10,
    watch:         false,
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file:   './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
