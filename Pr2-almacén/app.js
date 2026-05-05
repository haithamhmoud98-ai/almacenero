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
let selectedImages = [];
let selectionRects = [];
let currentScanImage = null;
let lastRecognizedLines = [];
let editingProductId = null;
let imageRemoved = false;

const video = document.getElementById("video");

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
        renderSavedProducts();

        const input = document.getElementById("searchInput");
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

function showSavedProductsPage(){
    document.getElementById("mainPage").style.display = "none";
    document.getElementById("savedProductsPage").style.display = "block";
    renderSavedProducts();
}

function showMainPage(){
    document.getElementById("savedProductsPage").style.display = "none";
    document.getElementById("mainPage").style.display = "block";
}

function parseLocation(location){
    if(!location) return { section:"", position:999, level:999 };

    const parts = location.toLowerCase().split("-");
    const section = parts[0] || "";
    const position = parseInt(parts[1]) || 999;

    let level = 999;
    if(parts[2] && parts[2].startsWith("n")){
        level = parseInt(parts[2].replace("n",""));
    }

    return { section, position, level };
}

const sectionOrder = ["pck", "a", "b", "c", "d", "sa", "sb"];

function sortProducts(list){
    return list.sort((a, b) => {
        const locA = parseLocation(a.location);
        const locB = parseLocation(b.location);

        let secA = sectionOrder.indexOf(locA.section);
        let secB = sectionOrder.indexOf(locB.section);

        if(secA === -1) secA = 999;
        if(secB === -1) secB = 999;

        if(secA !== secB) return secA - secB;
        if(locA.position !== locB.position) return locA.position - locB.position;

        return locA.level - locB.level;
    });
}

async function scanProduct(){
    try{
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = stream;

        await new Promise(resolve => setTimeout(resolve, 700));

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
        selectedImages = [];
        selectionRects = [];

        document.getElementById("scanPreview").src = img;
        document.getElementById("scanPreviewContainer").style.display = "block";
        document.getElementById("manualTextContainer").style.display = "none";
        document.getElementById("editDetectedTextBtn").style.display = "none";

        updateSelectionCount();
        enableSelection(img);
    }catch(e){
        alert("No se pudo usar la camara");
        console.error(e);
    }
}

async function confirmScan(){
    const imagesToProcess = selectedImages.length > 0 ? selectedImages : [scannedImage];

    if(!imagesToProcess[0]) return;

    document.getElementById("scanPreviewContainer").style.display = "none";
    document.getElementById("selectionCanvas").style.display = "none";
    document.getElementById("status").innerText = "Analizando...";
    document.getElementById("recognized").innerText = "";
    document.getElementById("result").innerHTML = "";
    document.getElementById("manualTextContainer").style.display = "none";
    document.getElementById("editDetectedTextBtn").style.display = "none";

    let allLines = [];

    for(const img of imagesToProcess){
        const lines = await analyzeImage(img);
        allLines = allLines.concat(lines);
    }

    allLines = [...new Set(allLines)];

    document.getElementById("status").innerText = "Analisis completado";

    lastRecognizedLines = allLines;
    showDetectedText(allLines);

    scannedImage = null;
    selectedImages = [];
    selectionRects = [];
}

function cancelScan(){
    scannedImage = null;
    selectedImages = [];
    selectionRects = [];

    document.getElementById("scanPreview").src = "";
    document.getElementById("selectionCanvas").style.display = "none";
    document.getElementById("scanPreviewContainer").style.display = "none";
    document.getElementById("manualTextContainer").style.display = "none";
    document.getElementById("editDetectedTextBtn").style.display = "none";

    updateSelectionCount();
}

function enableSelection(imageSrc){
    const canvas = document.getElementById("selectionCanvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.src = imageSrc;

    img.onload = () => {
        currentScanImage = img;

        const preview = document.getElementById("scanPreview");

        canvas.style.display = "block";
        canvas.width = preview.clientWidth;
        canvas.height = preview.clientHeight;

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

        function drawRects(tempRect = null){
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;

            selectionRects.forEach(rect => {
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            });

            if(tempRect){
                ctx.strokeStyle = "#00ffcc";
                ctx.strokeRect(tempRect.x, tempRect.y, tempRect.w, tempRect.h);
            }
        }

        function finishSelection(){
            isDrawing = false;

            let x = startX;
            let y = startY;
            let w = currentX - startX;
            let h = currentY - startY;

            if(w < 0){
                x = currentX;
                w = Math.abs(w);
            }

            if(h < 0){
                y = currentY;
                h = Math.abs(h);
            }

            if(w < 10 || h < 10){
                drawRects();
                return;
            }

            selectionRects.push({ x, y, w, h });

            const scaleX = img.width / canvas.width;
            const scaleY = img.height / canvas.height;

            const cropped = cropImage(
                img,
                x * scaleX,
                y * scaleY,
                w * scaleX,
                h * scaleY
            );

            selectedImages.push(cropped);
            drawRects();
            updateSelectionCount();
        }

        canvas.onmousedown = e => {
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;
            currentX = pos.x;
            currentY = pos.y;
            isDrawing = true;
        };

        canvas.onmousemove = e => {
            if(!isDrawing) return;
            const pos = getPos(e);
            currentX = pos.x;
            currentY = pos.y;
            drawRects({ x: startX, y: startY, w: currentX - startX, h: currentY - startY });
        };

        canvas.onmouseup = () => {
            if(!isDrawing) return;
            finishSelection();
        };

        canvas.ontouchstart = e => {
            e.preventDefault();
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;
            currentX = pos.x;
            currentY = pos.y;
            isDrawing = true;
        };

        canvas.ontouchmove = e => {
            e.preventDefault();
            if(!isDrawing) return;
            const pos = getPos(e);
            currentX = pos.x;
            currentY = pos.y;
            drawRects({ x: startX, y: startY, w: currentX - startX, h: currentY - startY });
        };

        canvas.ontouchend = e => {
            e.preventDefault();
            if(!isDrawing) return;
            finishSelection();
        };

        drawRects();
    };
}

function cropImage(img, sx, sy, w, h){
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);

    return canvas.toDataURL("image/png");
}

function undoSelection(){
    selectedImages.pop();
    selectionRects.pop();
    redrawSelectionCanvas();
    updateSelectionCount();
}

function clearSelections(){
    selectedImages = [];
    selectionRects = [];
    redrawSelectionCanvas();
    updateSelectionCount();
}

function redrawSelectionCanvas(){
    const canvas = document.getElementById("selectionCanvas");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;

    selectionRects.forEach(rect => {
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    });
}

function updateSelectionCount(){
    const count = document.getElementById("selectionCount");

    if(!count) return;

    count.innerText = selectedImages.length > 0
        ? `Selecciones: ${selectedImages.length}`
        : "Puedes seleccionar una o varias zonas de la imagen";
}

async function analyzeImage(img){
    try{
        const result = await Tesseract.recognize(img, "eng", {
            tessedit_pageseg_mode: 6
        });

        return result.data.text
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 2);
    }catch(error){
        console.error(error);
        return [];
    }
}

async function readText(img){
    document.getElementById("status").innerText = "Analizando...";

    const lines = await analyzeImage(img);

    document.getElementById("status").innerText = "Analisis completado";

    lastRecognizedLines = lines;
    showDetectedText(lines);
}

function showDetectedText(lines){
    const recognized = document.getElementById("recognized");
    const manualText = document.getElementById("manualText");
    const text = lines.join("\n");

    recognized.innerText = "Detectado:\n" + text;
    manualText.value = text;
    document.getElementById("manualTextContainer").style.display = "none";
    document.getElementById("editDetectedTextBtn").style.display = "block";

    searchLocations(lines);
    showScanSuggestions(lines);
}

function openManualTextEditor(){
    const manualText = document.getElementById("manualText");

    if(!manualText.value.trim()){
        manualText.value = lastRecognizedLines.join("\n");
    }

    document.getElementById("manualTextContainer").style.display = "block";
}

function applyManualText(){
    const manualText = document.getElementById("manualText");
    const lines = manualText.value
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 2);

    lastRecognizedLines = lines;

    document.getElementById("recognized").innerText =
        "Texto corregido:\n" + lines.join("\n");

    document.getElementById("result").innerHTML = "";

    searchLocations(lines);
    showScanSuggestions(lines);
}

function cancelManualText(){
    document.getElementById("manualTextContainer").style.display = "none";
}

function tokenize(text){
    return text.toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(" ")
        .filter(t => t.length > 1);
}

function smartMatch(input, product){
    const inputTokens = tokenize(input);
    const productTokens = tokenize(product || "");

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
    const found = [];

    lines.forEach(line => {
        let bestMatch = null;
        let bestScore = 0;

        products.forEach(p => {
            const score = smartMatch(line, p.name || "");

            if(score > bestScore){
                bestScore = score;
                bestMatch = p;
            }
        });

        if(bestScore > 0.3 && bestMatch){
            found.push(bestMatch);
        }
    });

    const unique = [];
    const ids = new Set();

    found.forEach(p => {
        if(!ids.has(p.id)){
            ids.add(p.id);
            unique.push(p);
        }
    });

    pickingList = sortProducts(unique);
    pickedItems.clear();

    renderPickingList();
}

function renderPickingList(){
    const container = document.getElementById("pickingList");
    const progress = document.getElementById("progress");
    const next = document.getElementById("nextItem");

    container.innerHTML = "";

    if(pickingList.length === 0){
        container.innerHTML = "<p>No hay lista</p>";
        progress.innerHTML = "";
        next.innerHTML = "";
        return;
    }

    const completed = pickedItems.size;
    const total = pickingList.length;
    const nextItem = pickingList.find(p => !pickedItems.has(p.id));

    progress.innerHTML = `${completed} / ${total}`;
    next.innerHTML = nextItem
        ? `${nextItem.name} (${nextItem.location || ""})`
        : "Completado";

    pickingList.forEach(p => {
        const done = pickedItems.has(p.id);

        container.innerHTML += `
        <div class="card row" style="opacity:${done ? 0.5 : 1};">
            ${p.image ? `<img src="${p.image}" class="product-img" onclick="openImage('${p.image}')">` : ""}

            <div onclick="togglePick('${p.id}')" style="flex:1;">
                <h3>${p.name || ""}</h3>
                <p>${p.location || ""}</p>
            </div>

            <div onclick="togglePick('${p.id}')" style="margin-right:10px;">
                ${done ? "OK" : "[]"}
            </div>

            <button onclick="editProduct('${p.id}')" class="warning">Editar</button>
            <button onclick="removeFromPicking('${p.id}')" class="danger">Quitar</button>
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
    const input = document.getElementById("searchInput").value.toLowerCase().trim();
    const result = document.getElementById("searchResults");

    result.innerHTML = "";

    if(!input) return;

    let matches = products.filter(p =>
        (p.name || "").toLowerCase().includes(input)
    );

    matches = sortProducts(matches);

    matches.forEach(p => {
        const alreadyAdded = pickingList.find(item => item.id === p.id);

        result.innerHTML += `
        <div class="card row">
            ${p.image ? `<img src="${p.image}" class="product-img" onclick="openImage('${p.image}')">` : ""}

            <div style="flex:1;">
                <h3>${p.name || ""}</h3>
                <p>${p.location || ""}</p>
            </div>

            <button onclick="editProduct('${p.id}')" class="warning">Editar</button>
            <button onclick="addToPicking('${p.id}')">
                ${alreadyAdded ? "OK" : "Agregar"}
            </button>
        </div>
        `;
    });
}

function renderSavedProducts(){
    const container = document.getElementById("savedProducts");

    if(!container) return;

    container.innerHTML = "";

    if(products.length === 0){
        container.innerHTML = "<p>No hay productos guardados</p>";
        return;
    }

    const sorted = sortProducts([...products]);

    sorted.forEach(p => {
        container.innerHTML += `
        <div class="card row">
            ${p.image ? `<img src="${p.image}" class="product-img" onclick="openImage('${p.image}')">` : ""}

            <div style="flex:1;">
                <h3>${p.name || ""}</h3>
                <p>${p.location || ""}</p>
            </div>

            <button onclick="editProduct('${p.id}')" class="warning">Editar</button>
            <button onclick="addToPicking('${p.id}')">Agregar</button>
        </div>
        `;
    });
}

function addToPicking(id){
    const product = products.find(p => p.id === id);

    if(!product) return;

    if(!pickingList.find(p => p.id === id)){
        pickingList.push(product);
    }

    pickingList = sortProducts(pickingList);

    renderPickingList();
    showScanSuggestionsFromCurrentResult();
}

function openImage(src){
    const modal = document.createElement("div");

    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.background = "rgba(0,0,0,0.9)";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = "2000";

    const img = document.createElement("img");
    img.src = src;
    img.style.maxWidth = "90%";
    img.style.maxHeight = "90%";

    modal.appendChild(img);
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
}

async function toggleCamera(){
    const video = document.getElementById("modalCamera");
    const preview = document.getElementById("preview");
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

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
                imageRemoved = false;

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

function openImagePicker(){
    document.getElementById("imageUpload").click();
}

function handleImageUpload(event){
    const file = event.target.files[0];

    if(!file) return;

    const reader = new FileReader();

    reader.onload = e => {
        capturedImage = e.target.result;
        imageRemoved = false;

        const preview = document.getElementById("preview");
        preview.src = capturedImage;
        preview.style.display = "block";

        document.getElementById("removeImageBtn").style.display = "block";
    };

    reader.readAsDataURL(file);
    event.target.value = "";
}

function removeImage(){
    capturedImage = null;
    imageRemoved = true;

    const preview = document.getElementById("preview");
    preview.src = "";
    preview.style.display = "none";

    document.getElementById("removeImageBtn").style.display = "none";
}

async function saveItem(){
    const name = document.getElementById("name").value.trim();
    const location = document.getElementById("location").value.trim();

    if(!name) return alert("Introduce el nombre");

    if(editingProductId){
        const data = { name, location };

        if(capturedImage){
            data.image = capturedImage;
        }

        if(imageRemoved){
            data.image = firebase.firestore.FieldValue.delete();
        }

        await db.collection("products").doc(editingProductId).update(data);
        alert("Producto actualizado");
    } else {
        const data = { name, location };

        if(capturedImage){
            data.image = capturedImage;
        }

        await db.collection("products").add(data);
        alert("Guardado");
    }

    closeModal();
}

async function deleteProduct(){
    if(!editingProductId) return;

    const product = products.find(p => p.id === editingProductId);
    const name = product && product.name ? product.name : "este producto";
    const confirmed = confirm(`Seguro que quieres eliminar "${name}"?`);

    if(!confirmed) return;

    await db.collection("products").doc(editingProductId).delete();

    pickingList = pickingList.filter(p => p.id !== editingProductId);
    pickedItems.delete(editingProductId);

    alert("Producto eliminado");
    closeModal();
}

function openModal(){
    editingProductId = null;
    imageRemoved = false;
    capturedImage = null;

    document.getElementById("modalTitle").innerText = "Anadir producto";
    document.getElementById("saveButton").innerText = "Guardar";
    document.getElementById("deleteProductBtn").style.display = "none";
    document.getElementById("name").value = "";
    document.getElementById("location").value = "";

    const preview = document.getElementById("preview");
    preview.src = "";
    preview.style.display = "none";

    document.getElementById("imageUpload").value = "";
    document.getElementById("removeImageBtn").style.display = "none";
    document.getElementById("modal").style.display = "block";
}

function editProduct(id){
    const product = products.find(p => p.id === id);

    if(!product) return alert("Producto no encontrado");

    editingProductId = id;
    imageRemoved = false;
    capturedImage = product.image || null;

    document.getElementById("modalTitle").innerText = "Editar producto";
    document.getElementById("saveButton").innerText = "Actualizar";
    document.getElementById("deleteProductBtn").style.display = "block";
    document.getElementById("name").value = product.name || "";
    document.getElementById("location").value = product.location || "";

    const preview = document.getElementById("preview");

    if(product.image){
        preview.src = product.image;
        preview.style.display = "block";
        document.getElementById("removeImageBtn").style.display = "block";
    } else {
        preview.src = "";
        preview.style.display = "none";
        document.getElementById("removeImageBtn").style.display = "none";
    }

    document.getElementById("modal").style.display = "block";
}

function closeModal(){
    if(modalStream){
        modalStream.getTracks().forEach(track => track.stop());
    }

    cameraOn = false;
    editingProductId = null;
    imageRemoved = false;
    capturedImage = null;

    document.getElementById("name").value = "";
    document.getElementById("location").value = "";

    const preview = document.getElementById("preview");
    preview.src = "";
    preview.style.display = "none";

    document.getElementById("imageUpload").value = "";
    document.getElementById("removeImageBtn").style.display = "none";
    document.getElementById("deleteProductBtn").style.display = "none";
    document.getElementById("modal").style.display = "none";
}

function showScanSuggestions(lines){
    const result = document.getElementById("result");
    let html = `<h3>Sugerencias</h3>`;
    const shownIds = new Set();

    lines.forEach(line => {
        let bestMatch = null;
        let bestScore = 0;

        products.forEach(p => {
            const score = smartMatch(line, p.name || "");

            if(score > bestScore){
                bestScore = score;
                bestMatch = p;
            }
        });

        if(bestScore > 0.3 && bestMatch){
            if(shownIds.has(bestMatch.id)) return;

            shownIds.add(bestMatch.id);

            const alreadyAdded = pickingList.find(p => p.id === bestMatch.id);

            html += `
            <div class="card row">
                ${bestMatch.image ? `<img src="${bestMatch.image}" class="product-img" onclick="openImage('${bestMatch.image}')">` : ""}

                <div style="flex:1;">
                    <strong>${bestMatch.name || ""}</strong><br>
                    Coincide con: ${line}
                    <p>${bestMatch.location || ""}</p>
                </div>

                <button onclick="editProduct('${bestMatch.id}')" class="warning">Editar</button>
                <button onclick="addToPicking('${bestMatch.id}')">
                    ${alreadyAdded ? "OK" : "Agregar"}
                </button>
            </div>
            `;
        }
    });

    result.innerHTML = html;
}

function showScanSuggestionsFromCurrentResult(){
    const manualText = document.getElementById("manualText");
    let lines = [];

    if(manualText && manualText.value.trim()){
        lines = manualText.value
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 2);
    } else {
        lines = lastRecognizedLines;
    }

    if(lines.length > 0){
        showScanSuggestions(lines);
    }
}
