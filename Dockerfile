# 1. Base Image: Use a lightweight version of Node 20
FROM node:20-alpine

# 2. Work Directory: Create a folder inside the container
WORKDIR /app

# 3. Dependencies: Copy package files first (better caching)
COPY package*.json ./

# 4. Install: Clean install of dependencies
RUN npm ci

# 5. Source: Copy the rest of your code
COPY . .

# 6. Default Command: Run the replay verification
# We default to 'replay' so it works without an API key immediately.
CMD ["npm", "run", "nodered:replay"]