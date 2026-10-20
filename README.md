<div align="center">
    <a href="https://www.cam.ac.uk/">
        <img src="https://www.cam.ac.uk/sites/www.cam.ac.uk/files/inner-images/logo.jpg" width="128px" />
    </a>
    <h1>LEXI: Large Language Models Experimental Interface</h1>
    <p>An innovative platform by <a href="https://cambridge-afar.github.io/">Affective Intelligence and Robotics Laboratory (AFAR)</a> of the University of Cambridge for conducting social interaction experiments with bots and Language Learning & Modeling Systems (LLMS).</p>
</div>

## 🌍 Project Overview

This platform is designed to facilitate advanced research in the field of user-bot interactions and LLMS models. It offers a comprehensive environment for conducting, monitoring, and analyzing experiments in this cutting-edge domain.

## 🏛️ About this version (BGU lab)

This is the Ben-Gurion University lab's version of Lexi, forked from [veb7vmehra/Lexi2.0](https://github.com/veb7vmehra/Lexi2.0). It is published for students to download, run and experiment with. The lab's production deployment is maintained separately.

Main additions over the original:

- **Group conversations**: several agents and one participant, with turn-taking, humanized typing and pacing, and token streaming.
- **Conversation phases**: agent behaviour that changes over a conversation, by turns or by time.
- **Survey-embedded conversations**: one conversation split into blocks between survey pages (e.g. Qualtrics), with survey answers passed to the agents.
- **More model providers**: OpenAI, Anthropic, Google, xAI and OpenRouter.
- **Per-researcher API keys**: each researcher adds their own keys in the admin UI, stored encrypted.
- **Accounts**: researcher accounts, password changes and admin password reset.

## 🚀 Quick Start

### Step 0: Download the following pre-requirements:

Node.js 22 - <a href="https://nodejs.org/en">https://nodejs.org/en</a> (Lexi is pinned to Node 22; npm comes with it)<br>
Git - <a href ="https://git-scm.com/downloads">https://git-scm.com/downloads</a><br>
Python 3 - <a href ="https://www.python.org/downloads/">https://www.python.org/downloads/</a> (only for the facial action-unit extraction)<br>
An API key for at least one model provider (OpenAI, Anthropic, Google, xAI or OpenRouter)

### Step 1: Set Up MongoDB Database

Before setting up the project, you'll need a MongoDB database. You can set this up locally on your machine, or use MongoDB Atlas for a cloud-based solution.

- **Setting up MongoDB Locally:**
  Follow [this guide](https://docs.mongodb.com/manual/installation/) to install MongoDB locally on your system. Your connection string will look like `mongodb://localhost:27017/lexi`.

- **Setting up MongoDB on Atlas:**
  MongoDB Atlas offers a cloud-based solution. You can set up a free cluster following [this guide](https://docs.atlas.mongodb.com/getting-started/). Atlas shows your connection string under **Connect → Drivers**: put your database user's password in place of `<db_password>`, and add a database name (e.g. `lexi`) right after `.mongodb.net/`.

  **Make sure you are adding your ip to be white listed**

### Step 2: Clone the Repository

```bash
git clone https://github.com/labbgulab-lab/Lexi2.0.git
cd Lexi2.0
```

### Step 3: Install Dependencies

- For the server:
  ```bash
  cd server
  npm run setup
  ```

- For the client:
  ```bash
  cd client
  npm run setup
  ```

### Setup Process Details

The server setup asks for one thing: your **full MongoDB connection string**, including the user, password and database name (see Step 1). It then:

- **Creates `server/.env`** with the connection string and freshly generated secrets: `JWT_SECRET_KEY` (signs logins) and `API_KEY_ENCRYPTION_KEY` (encrypts the API keys stored in the database). Keep this file; if you lose `API_KEY_ENCRYPTION_KEY`, the stored API keys can no longer be read and must be added again.
- **Installs dependencies and builds** the server.
- **Creates an admin user** with the username and password you choose.

The client setup creates `client/.env` pointing the client at `http://localhost:5000` and installs its dependencies.

### Step 4: Add an API key

Start the project (Step 7), log in with the admin user, and open **Settings → API Keys → Add API Key**. Agents can only use models from providers you have a key for.

### Step 5: Setting up openFace

The current [openFace](https://github.com/TadasBaltrusaitis/OpenFace) version downloaded with this github contains windows exe files, for linux and macOS, you can follow the following steps:

- [Installastion steps for Unix](https://github.com/TadasBaltrusaitis/OpenFace/wiki/Unix-Installation)
- [Installation steps for MacOS](https://github.com/TadasBaltrusaitis/OpenFace/wiki/Mac-installation)
- Make sure to install openFace inside the Lexi2.0 folder and rename the openface folder to "openFace".

If you haven't until now, irrespective of your OS, run the download_models.ps1 (for Windows) or download_models.sh (for Unix and MacOS), you can find these scripts inside the openFace folder.

### Step 6: Install pip requirements

Run the following command inside the Lexi2.0 folder from terminal.
```bash
pip install -r requirements.txt
```

### Step 7: Running the Project

- For the Server:
    ```bash
    cd server
    npm run dev
    ```
**server will run on: http://localhost:5000**

- For the Client:
    ```bash
    cd client
    npm start
    ```
**client will run on: http://localhost:3000**

- For action unit extaction:
  ```bash
  python AU_extractor.py
  ```

Encountering difficulties with your local environment setup? Consult the [Troubleshooting Guide](TROUBLESHOOTING..md). Conversation phases are documented in [PHASES.md](PHASES.md).

## 🌐 Deployment

Intersted to deploy Lexi? Please read our [Deployment Guide](DEPLOYMENT.md) for information on how to deploy.

## 🔗 Useful Links

- [Project Homepage](https://www.lexi.network/project-overview)
- [The original Lexi 2.0](https://github.com/veb7vmehra/Lexi2.0)

## 📄 License

This project is licensed under the [CC BY-NC 4.0 License](license): you may share and adapt it for non-commercial purposes, with credit to the original authors.

## 👍 Show Your Support

Give a ⭐️ if this project helped you! Your support encourages us tremendously.
