const firebaseConfig = {
    apiKey: "AIzaSyASGcks-5Vsg5i5xyZezOlNWah3T7kzYeo",
    authDomain: "scanner-project-7f8f0.firebaseapp.com",
    projectId: "scanner-project-7f8f0",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let products = [];
let stream = null;

let modalStream = null;
let capturedImage = null;
let cameraOn = false;

let pickingList = [];
let pickedItems = new Set();

let scannedImage = null;
let selectedImage = null;

function loadProducts(){
    db.collection("products").onSnapshot(snapshot => {
        products = [];

        snapshot.forEach(doc => {
            products.push({
                id: doc.id,
                ...doc.data()
            });
        });

        renderPickingList();

        let input = document.getElementById("searchInput");
        if(input && input.value){
            searchManual();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadProducts();

    const input = document.getElementById("searchInput");
    if(input){
        input.addEventListener("input", searchManual);
    }
});

const video = document.getElementById("video");

function parseLocation(location){
    if(!location) return { section:"", position:999, level:999 };

    let parts = location.toLowerCase().split("-");

    let section = parts[0] || "";
    let position = parseInt(parts[1]) || 999;

    let level = 999;
    if(parts[2] && parts[2].startsWith("n")){
        level = parseInt(parts[2].replace("n",""));
    }

    return { section, position, level };
}

const sectionOrder = ["pck", "a", "b", "c", "d", "sa", "sb"];

function sortProducts(list){
    return list.sort((a, b) => {
        let locA = parseLocation(a.location);
        let locB = parseLocation(b.location);

        let secA = sectionOrder.indexOf(locA.section);
        let secB = sectionOrder.indexOf(locB.section);

        if(secA === -1) secA = 999;
        if(secB === -1) secB = 999;

        if(secA !== secB) return secA - secB;

        if(locA.position !== locB.position){
            return locA.position - locB.position;
        }

        return locA.level - locB.level;
    });
}

async function scanProduct(){
    try{
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = stream;

        await new Promise(resolve => setTimeout(resolve, 500));

        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d");

        const width = video.videoWidth;
        const height = video.videoHeight;

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(video, 0, 0, width, height);

        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;

        const img = canvas.toDataURL("image/png");

        scannedImage = img;
        selectedImage = null;

        document.getElementById("scanPreview").src = img;
        document.getElementById("scanPreviewContainer").style.display = "block";

        enableSelection(img);

    }catch(e){
        alert("No se pudo usar la cámara");
        console.error(e);
    }
}

function confirmScan(){
    const imageToProcess = selectedImage || scannedImage;
    if(!imageToProcess) return;

    document.getElementById("scanPreviewContainer").style.display = "none";
    document.getElementById("selectionCanvas").style.display = "none";

    readText(imageToProcess);

    scannedImage = null;
    selectedImage = null;
}

function cancelScan(){
    scannedImage = null;
    selectedImage = null;

    document.getElementById("scanPreview").src = "";
    document.getElementById("selectionCanvas").style.display = "none";
    document.getElementById("scanPreviewContainer").style.display = "none";
}

function enableSelection(imageSrc){
    const canvas = document.getElementById("selectionCanvas");
    const ctx = canvas.getContext("2d");

    const img = new Image();
    img.src = imageSrc;

    img.onload = () => {
        const preview = document.getElementById("scanPreview");

        canvas.style.display = "block";

        canvas.width = preview.clientWidth;
        canvas.height = preview.clientHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let currentY = 0;
        let isDrawing = false;

        function getPos(e){
            const rect = canvas.getBoundingClientRect();

            if(e.touches && e.touches.length > 0){
                return {
                    x: e.touches[0].clientX - rect.left,
                    y: e.touches[0].clientY - rect.top
                };
            }

            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        function draw(){
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
        }

        function finishSelection(){
            isDrawing = false;

            const scaleX = img.width / canvas.width;
            const scaleY = img.height / canvas.height;

            processSelection(
                startX * scaleX,
                startY * scaleY,
                currentX * scaleX,
                currentY * scaleY,
                img
            );
        }

        canvas.onmousedown = (e) => {
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;
            currentX = pos.x;
            currentY = pos.y;
            isDrawing = true;
        };

        canvas.onmousemove = (e) => {
            if(!isDrawing) return;
            const pos = getPos(e);
            currentX = pos.x;
            currentY = pos.y;
            draw();
        };

        canvas.onmouseup = () => {
            if(!isDrawing) return;
            finishSelection();
        };

        canvas.ontouchstart = (e) => {
            e.preventDefault();
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;
            currentX = pos.x;
            currentY = pos.y;
            isDrawing = true;
        };

        canvas.ontouchmove = (e) => {
            e.preventDefault();
            if(!isDrawing) return;
            const pos = getPos(e);
            currentX = pos.x;
            currentY = pos.y;
            draw();
        };

        canvas.ontouchend = (e) => {
            e.preventDefault();
            if(!isDrawing) return;
            finishSelection();
        };
    };
}

function processSelection(sx, sy, ex, ey, img){
    let w = ex - sx;
    let h = ey - sy;

    if(w < 0){
        sx = ex;
        w = Math.abs(w);
    }

    if(h < 0){
        sy = ey;
        h = Math.abs(h);
    }

    if(w < 10 || h < 10){
        selectedImage = null;
        return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);

    selectedImage = canvas.toDataURL("image/png");
}

function readText(img){
    document.getElementById("status").innerText = "⏳ Analizando...";

    Tesseract.recognize(img, 'eng', {
        tessedit_pageseg_mode: 6
    }).then(({ data: { text } }) => {
        let lines = text.split("\n");

        let cleanedLines = lines
            .map(l => l.trim())
            .filter(l => l.length > 2);

        document.getElementById("status").innerText = "✅ Análisis completado";

        document.getElementById("recognized").innerText =
            "📄 Detectado:\n" + cleanedLines.join("\n");

        searchLocations(cleanedLines);
        showScanSuggestions(cleanedLines);
    }).catch(error => {
        document.getElementById("status").innerText = "❌ Error al analizar";
        console.error(error);
    });
}

function tokenize(text){
    return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t.length > 1);
}

function smartMatch(input, product){
    let inputTokens = tokenize(input);
    let productTokens = tokenize(product);

    if(productTokens.length === 0) return 0;

    let matches = 0;

    inputTokens.forEach(token => {
        if(productTokens.includes(token)){
            matches++;
        }
    });

    return matches / productTokens.length;
}

function searchLocations(lines){
    let found = [];

    lines.forEach(line => {
        let bestMatch = null;
        let bestScore = 0;

        products.forEach(p => {
            let score = smartMatch(line, p.name || "");

            if(score > bestScore){
                bestScore = score;
                bestMatch = p;
            }
        });

        if(bestScore > 0.3 && bestMatch){
            found.push(bestMatch);
        }
    });

    let unique = [];
    let ids = new Set();

    found.forEach(p => {
        if(!ids.has(p.id)){
            ids.add(p.id);
            unique.push(p);
        }
    });

    unique = sortProducts(unique);

    pickingList = unique;
    pickedItems.clear();

    renderPickingList();
}

function renderPickingList(){
    let container = document.getElementById("pickingList");
    let progress = document.getElementById("progress");
    let next = document.getElementById("nextItem");

    container.innerHTML = "";

    if(pickingList.length === 0){
        container.innerHTML = "<p>❌ No hay lista</p>";
        progress.innerHTML = "";
        next.innerHTML = "";
        return;
    }

    let completed = pickedItems.size;
    let total = pickingList.length;

    progress.innerHTML = `📊 ${completed} / ${total}`;

    let nextItem = pickingList.find(p => !pickedItems.has(p.id));

    next.innerHTML = nextItem
        ? `➡️ ${nextItem.name} (${nextItem.location})`
        : "✅ Completado";

    pickingList.forEach(p => {
        let done = pickedItems.has(p.id);

        container.innerHTML += `
        <div class="card row" style="opacity:${done ? 0.5 : 1};">
            ${p.image ? `<img src="${p.image}" class="product-img" onclick="openImage('${p.image}')">` : ""}

            <div onclick="togglePick('${p.id}')" style="flex:1;">
                <h3>📦 ${p.name}</h3>
                <p>📍 ${p.location}</p>
            </div>

            <div onclick="togglePick('${p.id}')" style="margin-right:10px;">
                ${done ? "✅" : "⬜"}
            </div>

            <button onclick="removeFromPicking('${p.id}')" style="background:red;">
                🗑
            </button>
        </div>
        `;
    });
}

function togglePick(id){
    if(pickedItems.has(id)){
        pickedItems.delete(id);
    } else {
        pickedItems.add(id);
    }

    renderPickingList();
}

function removeFromPicking(id){
    pickingList = pickingList.filter(p => p.id !== id);
    pickedItems.delete(id);
    renderPickingList();
}

function searchManual(){
    let input = document.getElementById("searchInput").value.toLowerCase().trim();
    let result = document.getElementById("searchResults");

    result.innerHTML = "";

    if(!input) return;

    let matches = products.filter(p =>
        (p.name || "").toLowerCase().includes(input)
    );

    matches = sortProducts(matches);

    matches.forEach(p => {
        let alreadyAdded = pickingList.find(item => item.id === p.id);

        result.innerHTML += `
        <div class="card row">
            ${p.image ? `<img src="${p.image}" class="product-img">` : ""}

            <div>
                <h3>${p.name}</h3>
                <p>${p.location}</p>
            </div>

            <button onclick="addToPicking('${p.id}')" style="margin-left:auto;">
                ${alreadyAdded ? "✔" : "➕"}
            </button>
        </div>
        `;
    });
}

function addToPicking(id){
    let product = products.find(p => p.id === id);

    if(!product) return;

    if(!pickingList.find(p => p.id === id)){
        pickingList.push(product);
    }

    pickingList = sortProducts(pickingList);

    renderPickingList();
}

function openImage(src){
    let modal = document.createElement("div");

    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.background = "rgba(0,0,0,0.9)";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = "2000";

    let img = document.createElement("img");
    img.src = src;
    img.style.maxWidth = "90%";
    img.style.maxHeight = "90%";

    modal.appendChild(img);

    modal.onclick = () => modal.remove();

    document.body.appendChild(modal);
}

async function toggleCamera(){
    let video = document.getElementById("modalCamera");
    let preview = document.getElementById("preview");
    let canvas = document.getElementById("canvas");
    let ctx = canvas.getContext("2d");

    if(!cameraOn){
        modalStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = modalStream;
        video.style.display = "block";

        cameraOn = true;

        video.onloadedmetadata = () => {
            setTimeout(() => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                ctx.drawImage(video, 0, 0);

                capturedImage = canvas.toDataURL("image/png");

                preview.src = capturedImage;
                preview.style.display = "block";

                document.getElementById("removeImageBtn").style.display = "block";

                modalStream.getTracks().forEach(track => track.stop());
                video.style.display = "none";

                cameraOn = false;
            }, 500);
        };
    }
}

function removeImage(){
    capturedImage = null;

    let preview = document.getElementById("preview");
    preview.src = "";
    preview.style.display = "none";

    document.getElementById("removeImageBtn").style.display = "none";
}

async function saveItem(){
    let name = document.getElementById("name").value;
    let location = document.getElementById("location").value;

    if(!name) return alert("Introduce el nombre");

    let data = { name, location };

    if(capturedImage){
        data.image = capturedImage;
    }

    await db.collection("products").add(data);

    alert("✅ Guardado");

    closeModal();
}

function openModal(){
    document.getElementById("modal").style.display = "block";
}

function closeModal(){
    if(modalStream){
        modalStream.getTracks().forEach(track => track.stop());
    }

    cameraOn = false;

    document.getElementById("name").value = "";
    document.getElementById("location").value = "";

    let preview = document.getElementById("preview");
    preview.src = "";
    preview.style.display = "none";

    document.getElementById("removeImageBtn").style.display = "none";

    capturedImage = null;

    document.getElementById("modal").style.display = "none";
}

function showScanSuggestions(lines){
    let result = document.getElementById("result");

    let html = `<h3>🧠 Sugerencias</h3>`;

    lines.forEach(line => {
        let bestMatch = null;
        let bestScore = 0;

        products.forEach(p => {
            let score = smartMatch(line, p.name || "");

            if(score > bestScore){
                bestScore = score;
                bestMatch = p;
            }
        });

        if(bestScore > 0.3 && bestMatch){
            let alreadyAdded = pickingList.find(p => p.id === bestMatch.id);

            html += `
            <div class="card row">
                <div style="flex:1;">
                    <strong>${line}</strong><br>
                    👉 ${bestMatch.name}
                </div>

                <button onclick="addToPicking('${bestMatch.id}')">
                    ${alreadyAdded ? "✔" : "➕"}
                </button>
            </div>
            `;
        }
    });

    result.innerHTML = html;
}
