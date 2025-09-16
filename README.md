
# 🚀 quickCHAT

A full-stack **real-time chat application** built with **MERN Stack**, **Socket.IO**, and **Cloudinary**.  
It provides secure authentication, real-time messaging, profile management, and online status tracking.

## 🚀 Live Demo
- [link:](https://quick-chat-tau.vercel.app/)

---

---

## ✨ Features

- 🔐 **User Authentication** (Signup, Login, JWT-protected routes)  
- 🧑‍🤝‍🧑 **Profile Management** (update profile info + upload avatar with Cloudinary)  
- 💬 **1-on-1 Real-Time Chat** using **Socket.IO**  
- 👀 **Seen/Unseen Message Tracking** with counters in sidebar  
- 🟢 **Online/Offline User Status**  
- 📷 **Image Messages Support**  
- 🎨 **Modern UI** built with **React 19**, **TailwindCSS 4**  
- ⚡ **Toasts & Notifications** with `react-hot-toast`

---

## 🛠️ Tech Stack

**Frontend**
- React 19  
- React Router v7  
- TailwindCSS v4  
- Socket.IO Client  
- React Hot Toast  

**Backend**
- Node.js + Express  
- MongoDB + Mongoose  
- JWT Authentication  
- Socket.IO Server  
- Cloudinary (image upload)  

---

## 📂 Project Structure

```

quickCHAT/
├── client/               # React frontend
│   ├── src/
│   │   ├── assets/       # images/icons
│   │   ├── context/      # AuthContext + ChatContext
│   │   ├── pages/        # HomePage, LoginPage, ProfilePage
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── server/               # Node.js backend
│   ├── models/           # User, Message
│   ├── controllers/      # auth + message controllers
│   ├── routes/           # authRoutes + messageRoutes
│   ├── middleware/       # auth middleware
│   ├── lib/              # db.js + cloudinary.js
│   ├── server.js         # main express + socket.io server
│   └── package.json
└── README.md

````

---

## ⚙️ Setup & Installation

### 1️⃣ Clone the repository
```bash
git clone https://github.com/yourusername/quickCHAT.git
cd quickCHAT
````

### 2️⃣ Backend setup

```bash
cd server
npm install
```

Create `.env` file inside `server/`:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
CLOUDINARY_CLOUD_NAME=xxxx
CLOUDINARY_API_KEY=xxxx
CLOUDINARY_API_SECRET=xxxx
```

Run backend:

```bash
npm run dev
```

### 3️⃣ Frontend setup

```bash
cd ../client
npm install
```

Create `.env` file inside `client/`:

```env
VITE_BACKEND_URL=http://localhost:5000
```

Run frontend:

```bash
npm run dev
```

---

## ▶️ Usage

1. Register a new account or log in.
2. Update your profile (name, bio, avatar).
3. Start chatting with other users in real time.
4. Messages update instantly with **seen/unseen tracking**.
5. Logout anytime to clear session.

---


## 🤝 Contributing

Contributions are welcome!

1. Fork the repo
2. Create a feature branch (`git checkout -b feature-name`)
3. Commit changes (`git commit -m "Added new feature"`)
4. Push and create a PR

---

## 📜 License

This project is licensed under the **MIT License**.
```
