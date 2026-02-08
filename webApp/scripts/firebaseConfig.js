// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  push, 
  set, 
  remove, 
  onValue,
  update,
  query,
  orderByChild,
  equalTo,
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBCpj8SzIGd4cAsO7WhYhMtcoqRpPszCkk",
  authDomain: "inventarioapp-32ea9.firebaseapp.com",
  databaseURL: "https://inventarioapp-32ea9-default-rtdb.firebaseio.com",
  projectId: "inventarioapp-32ea9",
  storageBucket: "inventarioapp-32ea9.firebasestorage.app",
  messagingSenderId: "566063946434",
  appId: "1:566063946434:web:0894ec80f1436909a7795b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Make Firebase available globally
window.firebaseDB = {
  database,
  ref,
  push,
  set,
  remove,
  onValue,
  update,
  query,
  orderByChild,
  equalTo,
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved
};

export { database, firebaseConfig };
