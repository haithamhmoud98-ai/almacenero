// 🔥 Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyASGcks-5Vsg5i5xyZezOlNWah3T7kzYeo",
  authDomain: "scanner-project-7f8f0.firebaseapp.com",
  projectId: "scanner-project-7f8f0",
  storageBucket: "scanner-project-7f8f0.firebasestorage.app",
  messagingSenderId: "50587873039",
  appId: "1:50587873039:web:77001997ae95e04093987a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let products = [];
let editingId = null;
let stream = null;

// 📦 تحميل المنتجات
function loadProducts(){
    db.collection("products").get().then(snapshot => {

        products = [];

        snapshot.forEach(doc => {
            products.push({
                id: doc.id,
                ...doc.data()
            });
        });

        console.log("Productos:", products);
    });
}

window.onload = function(){
    loadProducts();
};

// 🎥 الكاميرا
const video = document.getElementById("video");

// 📸 زر واحد (فتح + تصوير + إغلاق)
async function scanProduct(){

    try{
        // 🎥 فتح الكاميرا
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = stream;

        // ⏳ انتظار أفضل
        await new Promise(resolve => setTimeout(resolve, 1200));

        // 📸 تصوير
        let canvas = document.getElementById("canvas");
        let ctx = canvas.getContext("2d");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.drawImage(video, 0, 0);

        // 📴 إغلاق الكاميرا
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;

        let img = canvas.toDataURL("image/png");

        readText(img);

    }catch(e){
        alert("No se pudo usar la cámara");
    }
}

// 🔍 OCR
function readText(img){

    document.getElementById("status").innerText = "⏳ Analizando...";

    Tesseract.recognize(img, 'eng+spa', {
        logger: m => {
            document.getElementById("status").innerText =
                "📊 " + Math.round(m.progress * 100) + "%";
        }
    }).then(({ data: { text } }) => {

        document.getElementById("recognized").innerText =
            "📄 Texto detectado: " + text;

        searchProduct(text);
    });
}

// 🔎 البحث
function normalize(str){
    return str.toLowerCase().replace(/\s+/g,'').trim();
}

function searchProduct(text){

    let cleaned = normalize(text);

    let found = products.find(p =>
        normalize(p.name).includes(cleaned) ||
        cleaned.includes(normalize(p.name))
    );

    let result = document.getElementById("result");

    if(found){
        result.innerHTML = `
        <div class="card">
            <h3>${found.name}</h3>
            <img src="${found.image}?f_auto,q_auto,w_300">
            <p>📍 ${found.location}</p>

            <button onclick="editProduct('${found.id}')">✏️ Editar</button>
            <button onclick="deleteProduct('${found.id}')">🗑️ Eliminar</button>
        </div>
        `;
    } else {
        result.innerHTML = "<p>❌ Producto no encontrado</p>";
    }
}

// ☁️ Cloudinary
async function uploadImageToCloudinary(file){

    let formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "scanner_upload");

    let res = await fetch("https://api.cloudinary.com/v1_1/dx8hzinj/image/upload", {
        method: "POST",
        body: formData
    });

    let data = await res.json();
    return data.secure_url;
}

// ➕ modal
function openModal(){
    editingId = null;

    document.getElementById("modalTitle").innerText = "Añadir producto";
    document.getElementById("name").value = "";
    document.getElementById("location").value = "";
    document.getElementById("imageFile").value = "";

    document.getElementById("modal").style.display = "block";
}

function closeModal(){
    document.getElementById("modal").style.display = "none";
}

// ✏️ تعديل
function editProduct(id){

    let product = products.find(p => p.id === id);

    if(!product) return;

    document.getElementById("modalTitle").innerText = "Editar producto";

    document.getElementById("name").value = product.name;
    document.getElementById("location").value = product.location;

    editingId = id;

    document.getElementById("modal").style.display = "block";
}

// 🗑️ حذف
async function deleteProduct(id){

    let confirmDelete = confirm("¿Eliminar este producto?");

    if(!confirmDelete) return;

    await db.collection("products").doc(id).delete();

    alert("Producto eliminado ❌");

    loadProducts();

    document.getElementById("result").innerHTML = "";
}

// 💾 حفظ
async function saveItem(){

    let name = document.getElementById("name").value;
    let location = document.getElementById("location").value;
    let file = document.getElementById("imageFile").files[0];

    if(!name) return alert("Introduce el nombre");

    let data = {
        name,
        location
    };

    if(file){
        let imageUrl = await uploadImageToCloudinary(file);
        data.image = imageUrl;
    }

    // ✏️ تعديل
    if(editingId){
        await db.collection("products").doc(editingId).update(data);
        alert("Producto actualizado ✏️");
    }
    // ➕ إضافة
    else{
        await db.collection("products").add(data);
        alert("Producto añadido ✅");
    }

    closeModal();
    loadProducts();
}