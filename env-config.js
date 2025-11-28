// Environment Configuration for Zeabur Deployment
// Zeabur automatically provides these MySQL environment variables:

MYSQL_HOST=${CONTAINER_HOSTNAME}  // Database host (automatically set by Zeabur)
MYSQL_PORT=${DATABASE_PORT}       // Database port (automatically set by Zeabur)
MYSQL_ROOT_PASSWORD=${PASSWORD}   // Database password (automatically set by Zeabur)
MYSQL_USERNAME=root               // Database username (automatically set by Zeabur)
MYSQL_DATABASE=zeabur             // Database name (automatically set by Zeabur)
PASSWORD=5N29BnfD0RbMw4Wd6y1iVPEgUI783voa  // Actual password value

// Additional environment variables you may want to set:

JWT_SECRET=gps-task-secret-key-change-in-production
JWT_EXPIRE=7d

ALLOWED_ORIGINS=https://gpstask.zeabur.app,http://localhost:3001

NODE_ENV=production
