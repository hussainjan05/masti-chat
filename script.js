
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, updateProfile, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
    import { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, doc, setDoc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    /* =====================
       1) CONFIG
       ===================== */
   
    const firebaseConfig = {
      apiKey: "AIzaSyBgLv_euy0hiLS7hPUvh6J9xw1kQQwJ88A",
      authDomain: "chat-app-84f22.firebaseapp.com",
      projectId: "chat-app-84f22",
      storageBucket: "chat-app-84f22.firebasestorage.app",
      messagingSenderId: "290340899268",
      appId: "1:290340899268:web:92a8aad0aef221506ebc91"
    };
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    /* =====================
       2) THEME TOGGLE
       ===================== */
    const d = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleAuth = document.getElementById('themeToggleAuth');
    const applyTheme = (t)=>{ d.setAttribute('data-theme', t); localStorage.setItem('masti-theme', t); };
    const savedTheme = localStorage.getItem('masti-theme') || 'dark';
    applyTheme(savedTheme);
    [themeToggle, themeToggleAuth].forEach(btn=> btn?.addEventListener('click', ()=> applyTheme(d.getAttribute('data-theme')==='dark'?'light':'dark')));

    /* =====================
       3) DOM REFS
       ===================== */
    const $ = (id)=>document.getElementById(id);
    const authView = $('auth');
    const appView = $('app');
    const meNameEl = $('meName');
    const mePhotoEl = $('mePhoto');
    const userListEl = $('userList');
    const roomListEl = $('roomList');
    const roomCountEl = $('roomCount');
    const msgInput = $('msgInput');
    const messagesEl = $('messages');
    const chatTitle = $('chatTitle');
    const chatSubtitle = $('chatSubtitle');
    const hamburger = $('hamburger');
    const sidebar = $('sidebar');
    const sidebarOverlay = $('sidebarOverlay');

    let currentMode = null; // 'dm' or 'room'
    let currentPeer = null; // user object for DM
    let currentRoomId = null; // string for room
    let unsub = null;

    /* =====================
       4) HAMBURGER MENU TOGGLE
       ===================== */
    function toggleSidebar() {
      sidebar.classList.toggle('show');
      hamburger.classList.toggle('active');
      sidebarOverlay.classList.toggle('active');
    }
    
    hamburger.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', toggleSidebar);
    
    // Close sidebar when a chat is selected (on mobile)
    function closeSidebarOnMobile() {
      if (window.innerWidth <= 960) {
        toggleSidebar();
      }
    }

    /* =====================
       5) AUTH
       ===================== */
    $('googleBtn').addEventListener('click', async ()=>{
      try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch(e){ alert(e.message); }
    });
    $('guestBtn').addEventListener('click', async ()=>{
      const cred = await signInAnonymously(auth);
      await updateProfile(cred.user, { displayName: 'Guest-'+cred.user.uid.slice(0,5) });
    });
    $('signOut').addEventListener('click', ()=> fbSignOut(auth));

    onAuthStateChanged(auth, async user => {
      if (user) {
        authView.style.display='none'; appView.style.display='grid';
        meNameEl.textContent = user.displayName||'Unknown';
        if (user.photoURL) { mePhotoEl.src = user.photoURL; mePhotoEl.style.display='block'; }
        await upsertUser(user);
        await ensureDefaultRooms();
        loadUsers();
        loadRooms();
        // default view
        setWelcome();
        // prepare E2EE keys
        await ensureKeypair();
      } else {
        authView.style.display='grid'; appView.style.display='none';
        cleanupListener();
      }
    });

    async function upsertUser(u){
      await setDoc(doc(db,'users',u.uid),{
        uid:u.uid, name:u.displayName||'Unknown', email:u.email||'', photoURL:u.photoURL||'',
        publicKeyPem: (await getStoredPublicKeyPem())||null, // may be null until generated
        updatedAt: serverTimestamp()
      },{merge:true});
    }

    /* =====================
       6) USERS & ROOMS LISTS
       ===================== */
    async function loadUsers(){
      userListEl.innerHTML = '';
      const snap = await getDocs(collection(db,'users'));
      const myId = auth.currentUser.uid;
      snap.forEach(docu=>{
        const u = docu.data(); if (u.uid===myId) return;
        const div = document.createElement('div');
        div.className='item';
        div.innerHTML = `<img class="avatar" src="${u.photoURL||''}" alt=""/><div><div><strong>${escapeHTML(u.name||'User')}</strong></div><div class="muted">${u.email||''}</div></div>`;
        div.addEventListener('click',()=> { openDM(u); closeSidebarOnMobile(); });
        userListEl.appendChild(div);
      });
    }

    async function ensureDefaultRooms(){
      const defaults = [{id:'general',name:'General'},{id:'saylani',name:'Saylani Class'}];
      for (const r of defaults){
        const ref = doc(db,'rooms',r.id); const s=await getDoc(ref); if(!s.exists()) await setDoc(ref,{name:r.name,createdAt:serverTimestamp()});
      }
    }
    $('roomGo').addEventListener('click', async ()=>{
      const val = $('roomInput').value.trim(); if(!val) return;
      const id = val.toLowerCase().replace(/[^a-z0-9_-]+/g,'-');
      await setDoc(doc(db,'rooms',id),{name:val,createdAt:serverTimestamp()},{merge:true});
      $('roomInput').value='';
      loadRooms();
      openRoom(id,val);
      closeSidebarOnMobile();
    });
    async function loadRooms(){
      roomListEl.innerHTML=''; let count=0;
      const snap = await getDocs(collection(db,'rooms'));
      snap.forEach(d=>{ count++; const r=d.data(); const div=document.createElement('div');
        div.className='item'; div.innerHTML=`<div><strong>${escapeHTML(r.name||d.id)}</strong><div class="muted">${d.id}</div></div>`;
        div.addEventListener('click',()=> { openRoom(d.id,r.name); closeSidebarOnMobile(); }); 
        roomListEl.appendChild(div);
      });
      roomCountEl.textContent = count+'';
    }

    /* =====================
       7) OPEN VIEWS
       ===================== */
    function setWelcome(){ currentMode=null; chatTitle.textContent='Welcome 👋'; chatSubtitle.textContent='Select a user to DM (E2EE) or a room to chat'; messagesEl.innerHTML=''; }

    async function openDM(peer){
      currentMode='dm'; currentPeer=peer; currentRoomId=null; messagesEl.innerHTML='';
      chatTitle.textContent = `DM • ${peer.name}`; chatSubtitle.textContent = 'End‑to‑end encrypted';
      await ensureConversationWith(peer.uid); // create key if missing
      listenDM(peer.uid);
    }

    async function openRoom(id,name){
      currentMode='room'; currentPeer=null; currentRoomId=id; messagesEl.innerHTML='';
      chatTitle.textContent = name||id; chatSubtitle.textContent = 'Public room (not E2EE)';
      listenRoom(id);
    }

    /* =====================
       8) FIRESTORE LISTENERS
       ===================== */
    function cleanupListener(){ if(typeof unsub==='function'){ unsub(); unsub=null; } }

    function convId(a,b){ return [a,b].sort().join('_'); }

    function listenRoom(roomId){
      cleanupListener();
      const ref = collection(db,'rooms',roomId,'messages');
      const qy = query(ref, orderBy('createdAt','asc'), limit(300));
      unsub = onSnapshot(qy, snap=>{ messagesEl.innerHTML=''; snap.forEach(d=> renderMessage(d.data())); messagesEl.scrollTop = messagesEl.scrollHeight; });
    }

    async function listenDM(peerUid){
      cleanupListener();
      const cid = convId(auth.currentUser.uid, peerUid);
      const ref = collection(db,'conversations',cid,'messages');
      const qy = query(ref, orderBy('createdAt','asc'), limit(300));
      const privateKey = await getPrivateKey();
      unsub = onSnapshot(qy, async snap=>{
        messagesEl.innerHTML='';
        for (const d of snap.docs){ const m=d.data(); const text = await decryptIfNeeded(m, privateKey); renderMessage({...m, text}); }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }

    /* =====================
       9) SENDING MESSAGES
       ===================== */
    document.getElementById('composer').addEventListener('submit', async (e)=>{
      e.preventDefault(); const text = msgInput.value.trim(); if(!text) return; msgInput.value='';
      if(currentMode==='room'){ await sendRoom(text); } else if(currentMode==='dm'){ await sendDM(text); } else { alert('Select a chat first'); }
    });

    async function sendRoom(text){
      const ref = collection(db,'rooms',currentRoomId,'messages');
      await addDoc(ref,{ text, uid:auth.currentUser.uid, name:auth.currentUser.displayName||'Unknown', photoURL:auth.currentUser.photoURL||'', createdAt:serverTimestamp() });
    }

    async function sendDM(plaintext){
      const my = auth.currentUser; const peer = currentPeer; if(!peer) return;
      const cid = convId(my.uid, peer.uid);
      const convRef = doc(db,'conversations',cid);
      const convSnap = await getDoc(convRef);
      if(!convSnap.exists()){ await ensureConversationWith(peer.uid); }
      const {aesKey} = await loadConversationKey(cid);
      const {cipherB64, ivB64} = await aesEncryptText(aesKey, plaintext);
      const ref = collection(db,'conversations',cid,'messages');
      await addDoc(ref,{ cipher:cipherB64, iv:ivB64, e2ee:true, uid:my.uid, name:my.displayName||'Unknown', createdAt:serverTimestamp() });
    }

    function renderMessage(m){
      const isMe = auth.currentUser && m.uid === auth.currentUser.uid;
      const div = document.createElement('div');
      div.className = 'msg ' + (isMe ? 'me' : 'you');
      const when = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
      const hh = when.getHours().toString().padStart(2,'0');
      const mm = when.getMinutes().toString().padStart(2,'0');
      const text = escapeHTML(m.text || (m.e2ee? '[encrypted message]':'') || '');
      div.innerHTML = `<div>${text}</div><div class="meta">${isMe?'You':escapeHTML(m.name||'User')} • ${hh}:${mm}</div>`;
      messagesEl.appendChild(div);
    }

    /* =====================
       10) E2EE KEYS & HELPERS (DM only)
       - Each user has RSA-OAEP keypair (private stays local, public in Firestore)
       - Each conversation has a random AES-GCM key, stored encrypted for both users
       ===================== */
    async function ensureKeypair(){
      // already have?
      const priv = localStorage.getItem('masti-priv'); const pub = localStorage.getItem('masti-pub');
      if(priv && pub){ return; }
      const kp = await crypto.subtle.generateKey({name:'RSA-OAEP', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256'}, true, ['encrypt','decrypt']);
      const spub = await crypto.subtle.exportKey('spki', kp.publicKey); const spriv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
      const pubPem = spkiToPem(spub); const privPem = pkcs8ToPem(spriv);
      localStorage.setItem('masti-pub', pubPem); localStorage.setItem('masti-priv', privPem);
      // update Firestore user public key
      await setDoc(doc(db,'users',auth.currentUser.uid),{ publicKeyPem: pubPem },{merge:true});
    }
    async function getStoredPublicKeyPem(){ return localStorage.getItem('masti-pub') || null; }
    async function getPrivateKey(){ const pem = localStorage.getItem('masti-priv'); return pem? importPrivateKey(pem):null; }
    async function getPublicKey(uid){
      const s = await getDoc(doc(db,'users',uid)); const pem = s.data()?.publicKeyPem; return pem? importPublicKey(pem):null;
    }

    async function ensureConversationWith(peerUid){
      const cid = convId(auth.currentUser.uid, peerUid);
      const ref = doc(db,'conversations',cid); const snap = await getDoc(ref);
      if(snap.exists()){ return; }
      // create new AES key and encrypt for both users
      const aesKey = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const raw = await crypto.subtle.exportKey('raw', aesKey);
      const myPub = await getPublicKey(auth.currentUser.uid) || await importPublicKey(localStorage.getItem('masti-pub'));
      const peerPub = await getPublicKey(peerUid);
      if(!peerPub) { alert('Peer has no public key yet (they must sign in once).'); return; }
      const encMine = await rsaEncrypt(myPub, new Uint8Array(raw));
      const encPeer = await rsaEncrypt(peerPub, new Uint8Array(raw));
      await setDoc(ref, { createdAt: serverTimestamp(), keys: { [auth.currentUser.uid]: encMine, [peerUid]: encPeer } });
    }

    async function loadConversationKey(cid){
      const ref = doc(db,'conversations',cid); const snap = await getDoc(ref); const data=snap.data();
      const blobB64 = data?.keys?.[auth.currentUser.uid]; if(!blobB64) throw new Error('No key for you in this conversation.');
      const priv = await getPrivateKey();
      const raw = await rsaDecrypt(priv, b64ToBytes(blobB64));
      const key = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
      return { aesKey: key };
    }

    async function decryptIfNeeded(m, privateKey){
      if(!m.e2ee) return m.text || '';
      try{
        const cid = convId(auth.currentUser.uid, m.uid===auth.currentUser.uid? currentPeer.uid: currentPeer.uid);
        const {aesKey} = await loadConversationKey(cid);
        const text = await aesDecryptText(aesKey, m.cipher, m.iv);
        return text;
      }catch(e){ return '[cannot decrypt]'; }
    }

    // --- Crypto helpers ---
    function spkiToPem(buf){ const b=btoa(String.fromCharCode(...new Uint8Array(buf))); return `-----BEGIN PUBLIC KEY-----\n${b.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`; }
    function pkcs8ToPem(buf){ const b=btoa(String.fromCharCode(...new Uint8Array(buf))); return `-----BEGIN PRIVATE KEY-----\n${b.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`; }
    async function importPublicKey(pem){ const b64=pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g,'').replace(/\s+/g,''); const der=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); return crypto.subtle.importKey('spki', der, {name:'RSA-OAEP', hash:'SHA-256'}, true, ['encrypt']); }
    async function importPrivateKey(pem){ const b64=pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g,'').replace(/\s+/g,''); const der=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); return crypto.subtle.importKey('pkcs8', der, {name:'RSA-OAEP', hash:'SHA-256'}, false, ['decrypt']); }
    async function rsaEncrypt(pub, bytes){ const enc = await crypto.subtle.encrypt({name:'RSA-OAEP'}, pub, bytes); return bytesToB64(new Uint8Array(enc)); }
    async function rsaDecrypt(priv, bytes){ const dec = await crypto.subtle.decrypt({name:'RSA-OAEP'}, priv, bytes); return new Uint8Array(dec); }

    async function aesEncryptText(key, text){ const iv=crypto.getRandomValues(new Uint8Array(12)); const enc=await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(text)); return {cipherB64:bytesToB64(new Uint8Array(enc)), ivB64:bytesToB64(iv)}; }
    async function aesDecryptText(key, cipherB64, ivB64){ const iv=b64ToBytes(ivB64); const data=b64ToBytes(cipherB64); const dec=await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data); return new TextDecoder().decode(dec); }

    function bytesToB64(bytes){ let bin=''; bytes.forEach(b=> bin+=String.fromCharCode(b)); return btoa(bin); }
    function b64ToBytes(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }

    /* =====================
       11) UTILS
       ===================== */
    function escapeHTML(str){ return (str||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

