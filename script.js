  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, updateProfile, signOut as fbSignOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
    import { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, doc, setDoc, getDoc, getDocs, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    // ===== 1) CONFIG =====
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

    // ===== 2) THEME TOGGLE =====
    const d = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleAuth = document.getElementById('themeToggleAuth');
    const applyTheme = (t)=>{ d.setAttribute('data-theme', t); localStorage.setItem('masti-theme', t); };
    const savedTheme = localStorage.getItem('masti-theme') || 'dark';
    applyTheme(savedTheme);
    [themeToggle, themeToggleAuth].forEach(btn=> btn?.addEventListener('click', ()=> applyTheme(d.getAttribute('data-theme')==='dark'?'light':'dark')));

    // ===== 3) DOM REFS =====
    const $ = (id)=>document.getElementById(id);
    const authView = $('auth');
    const appView = $('app');
    const meNameEl = $('meName');
    const mePhotoEl = $('mePhoto');
    const messagesEl = $('messages');
    const chatTitle = $('chatTitle');
    const chatSubtitle = $('chatSubtitle');
    const hamburger = $('hamburger');
    const sidebar = $('sidebar');
    const sidebarOverlay = $('sidebarOverlay');
    const emailSearch = $('emailSearch');
    const addByEmailBtn = $('addByEmail');
    const requestsList = $('requestsList');
    const friendsList = $('friendsList');
    const confirmDialog = $('confirmDialog');
    const overlay = $('overlay');
    const confirmDeleteBtn = $('confirmDelete');
    const cancelDeleteBtn = $('cancelDelete');

    let currentMode = null; // 'dm' | 'room'
    let currentPeer = null; // {uid,name,photoURL}
    let currentRoomId = null; // 'general'
    let unsub = null; // messages listener
    let unsubFriends = null; // friends listener
    let unsubRequests = null; // requests listener
    let messageToDelete = null; // Stores message info for deletion

    // ===== 4) HAMBURGER TOGGLE =====
    function toggleSidebar(){ sidebar.classList.toggle('show'); hamburger.classList.toggle('active'); sidebarOverlay.classList.toggle('active'); }
    hamburger.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', toggleSidebar);
    function closeSidebarOnMobile(){ if (window.innerWidth <= 960) toggleSidebar(); }

    // ===== 5) AUTH =====
    $('googleBtn').addEventListener('click', async ()=>{
      try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch(e){ alert(e.message); }
    });
    $('guestBtn').addEventListener('click', async ()=>{
      const cred = await signInAnonymously(auth); await updateProfile(cred.user, { displayName: 'Guest-'+cred.user.uid.slice(0,5) });
    });

    // Delete account on sign out (as requested). If delete fails (needs recent login), just sign out.
    $('deleteAndSignOut').addEventListener('click', async ()=>{
      const u = auth.currentUser;
      if (!u) return;
      try {
        // remove user profile doc
        await deleteDoc(doc(db,'users',u.uid));
        // delete auth user
        await deleteUser(u);
      } catch (err) {
        console.warn('Delete failed, signing out instead:', err.message);
        await fbSignOut(auth);
      }
    });

    onAuthStateChanged(auth, async user => {
      if (user) {
        authView.style.display='none'; appView.style.display='grid';
        meNameEl.textContent = user.displayName||'Unknown';
        if (user.photoURL) { mePhotoEl.src = user.photoURL; mePhotoEl.style.display='block'; }
        await upsertUser(user);
        await ensureGeneralRoom();
        startFriendsListener();
        startRequestsListener();
        setWelcome();
      } else {
        authView.style.display='grid'; appView.style.display='none';
        cleanupListener();
        cleanupFriends();
        cleanupRequests();
      }
    });

    async function upsertUser(u){
      await setDoc(doc(db,'users',u.uid),{
        uid:u.uid, name:u.displayName||'Unknown', email:u.email||'', photoURL:u.photoURL||'', createdAt: serverTimestamp()
      },{merge:true});
    }

    // ===== 6) FRIENDS & REQUESTS =====
    function startFriendsListener(){
      cleanupFriends();
      const ref = collection(db, 'users', auth.currentUser.uid, 'friends');
      unsubFriends = onSnapshot(ref, async (snap)=>{
        friendsList.innerHTML = '';
        for (const d of snap.docs){
          const fid = d.id; // friend uid
          const uDoc = await getDoc(doc(db,'users',fid));
          const u = uDoc.data();
          if (!u) continue;
          const div = document.createElement('div');
          div.className = 'item';
          div.innerHTML = `<img class="avatar" src="${u.photoURL||''}" alt=""/><div><div><strong>${escapeHTML(u.name||'User')}</strong></div><div class="muted small">${escapeHTML(u.email||'')}</div></div>`;
          div.addEventListener('click', ()=>{ openDM(u); closeSidebarOnMobile(); });
          friendsList.appendChild(div);
        }
        // Always keep General room button wired
        $('openGeneral').onclick = ()=>{ openRoom('general','General'); closeSidebarOnMobile(); };
      });
    }
    function cleanupFriends(){ if (typeof unsubFriends==='function') {unsubFriends(); unsubFriends=null;} }

    function startRequestsListener(){
      cleanupRequests();
      const qy = query(collection(db,'requests'), where('to','==', auth.currentUser.uid), where('status','==','pending'));
      unsubRequests = onSnapshot(qy, async (snap)=>{
        requestsList.innerHTML = '';
        for (const d of snap.docs){
          const r = d.data();
          const fromUser = (await getDoc(doc(db,'users', r.from))).data();
          const row = document.createElement('div');
          row.className = 'item';
          row.innerHTML = `
            <img class="avatar" src="${fromUser?.photoURL||''}"/>
            <div class="grow">
              <div><strong>${escapeHTML(fromUser?.name||'User')}</strong></div>
              <div class="muted small">${escapeHTML(fromUser?.email||'')}</div>
            </div>
            <div class="row">
              <button class="btn small" id="acc_${d.id}">✔</button>
              <button class="btn secondary small" id="dec_${d.id}">✖</button>
            </div>`;
          requestsList.appendChild(row);
          $('acc_'+d.id).onclick = ()=> acceptRequest(d.id, r.from, r.to);
          $('dec_'+d.id).onclick = ()=> declineRequest(d.id);
        }
      });
    }
    function cleanupRequests(){ if (typeof unsubRequests==='function') {unsubRequests(); unsubRequests=null;} }

    // Send friend request by email
    addByEmailBtn.addEventListener('click', async ()=>{
      const email = emailSearch.value.trim().toLowerCase();
      if (!email) return;
      if (!auth.currentUser) return alert('Please sign in');
      // find user by email
      const qs = await getDocs(query(collection(db,'users'), where('email','==', email)));
      if (qs.empty) return alert('No user found with that email');
      const target = qs.docs[0].data();
      if (target.uid === auth.currentUser.uid) return alert("That's you!");
      // create request if not existing
      const existing = await getDocs(query(collection(db,'requests'), where('from','==',auth.currentUser.uid), where('to','==',target.uid), where('status','==','pending')));
      if (!existing.empty) return alert('Request already sent');
      await addDoc(collection(db,'requests'), {
        from: auth.currentUser.uid,
        to: target.uid,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      emailSearch.value='';
      alert('Friend request sent');
    });

    async function acceptRequest(reqId, fromUid, toUid){
      // add each other in friends subcollection
      await setDoc(doc(db,'users', toUid, 'friends', fromUid), { since: serverTimestamp() });
      await setDoc(doc(db,'users', fromUid, 'friends', toUid), { since: serverTimestamp() });
      // mark request accepted
      await setDoc(doc(db,'requests', reqId), { status: 'accepted' }, { merge:true });
    }
    async function declineRequest(reqId){
      await setDoc(doc(db,'requests', reqId), { status: 'declined' }, { merge:true });
    }

    // ===== 7) OPEN VIEWS =====
    function setWelcome(){ currentMode=null; chatTitle.textContent='Welcome 👋'; chatSubtitle.textContent='Select a friend to DM or open the General room'; messagesEl.innerHTML=''; }

    async function openDM(peer){
      currentMode='dm'; currentPeer=peer; currentRoomId=null; messagesEl.innerHTML='';
      chatTitle.textContent = `DM • ${peer.name}`; chatSubtitle.textContent = 'Direct message';
      listenDM(peer.uid);
    }

    async function openRoom(id,name){
      currentMode='room'; currentPeer=null; currentRoomId=id; messagesEl.innerHTML='';
      chatTitle.textContent = name||id; chatSubtitle.textContent = 'Room chat';
      listenRoom(id);
    }

    // ===== 8) LISTENERS =====
    function cleanupListener(){ if (typeof unsub==='function'){ unsub(); unsub=null; } }

    function convId(a,b){ return [a,b].sort().join('_'); }

    async function ensureGeneralRoom(){
      const ref = doc(db,'rooms','general');
      const s = await getDoc(ref); if (!s.exists()) await setDoc(ref, { name:'General', createdAt: serverTimestamp() });
      $('openGeneral').onclick = ()=> openRoom('general','General');
    }

    function listenRoom(roomId){
      cleanupListener();
      const ref = collection(db,'rooms',roomId,'messages');
      const qy = query(ref, orderBy('createdAt','asc'), limit(300));
      unsub = onSnapshot(qy, snap=>{ 
        messagesEl.innerHTML=''; 
        snap.forEach(d=> renderMessage(d.data(), d.id)); 
        messagesEl.scrollTop = messagesEl.scrollHeight; 
      });
    }

    function listenDM(peerUid){
      cleanupListener();
      const cid = convId(auth.currentUser.uid, peerUid);
      const ref = collection(db,'conversations',cid,'messages');
      const qy = query(ref, orderBy('createdAt','asc'), limit(300));
      unsub = onSnapshot(qy, snap=>{ 
        messagesEl.innerHTML=''; 
        snap.forEach(d=> renderMessage(d.data(), d.id)); 
        messagesEl.scrollTop = messagesEl.scrollHeight; 
      });
    }

    // ===== 9) SENDING MESSAGES =====
    document.getElementById('composer').addEventListener('submit', async (e)=>{
      e.preventDefault(); const text = $('msgInput').value.trim(); if(!text) return; $('msgInput').value='';
      if(currentMode==='room'){ await sendRoom(text); } else if(currentMode==='dm'){ await sendDM(text); } else { alert('Select a chat first'); }
    });

    async function sendRoom(text){
      const ref = collection(db,'rooms', currentRoomId || 'general', 'messages');
      await addDoc(ref,{ text, uid:auth.currentUser.uid, name:auth.currentUser.displayName||'Unknown', photoURL:auth.currentUser.photoURL||'', createdAt:serverTimestamp() });
    }

    async function sendDM(text){
      const my = auth.currentUser; const peer = currentPeer; if(!peer) return;
      const cid = convId(my.uid, peer.uid);
      const ref = collection(db,'conversations',cid,'messages');
      await addDoc(ref,{ text, uid:my.uid, name:my.displayName||'Unknown', createdAt: serverTimestamp() });
    }

    // ===== 10) RENDER & DELETE MESSAGES =====
    function renderMessage(m, messageId){
      const isMe = auth.currentUser && m.uid === auth.currentUser.uid;
      const div = document.createElement('div');
      div.className = 'msg ' + (isMe ? 'me' : 'you');
      const when = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
      const hh = when.getHours().toString().padStart(2,'0');
      const mm = when.getMinutes().toString().padStart(2,'0');
      const text = escapeHTML(m.text || '');
      
      // Add delete button for user's own messages
      const deleteButton = isMe ? 
        `<div class="msg-actions">
          <button class="delete-btn" data-message-id="${messageId}">×</button>
        </div>` : '';
      
      div.innerHTML = `
        ${deleteButton}
        <div>${text}</div>
        <div class="meta">${isMe?'You':escapeHTML(m.name||'User')} • ${hh}:${mm}</div>
      `;
      messagesEl.appendChild(div);
      
      // Add event listener to delete button
      if (isMe) {
        const deleteBtn = div.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showDeleteConfirmation(messageId);
        });
      }
    }

    // Show confirmation dialog for message deletion
    function showDeleteConfirmation(messageId) {
      messageToDelete = messageId;
      confirmDialog.style.display = 'block';
      overlay.style.display = 'block';
    }

    // Hide confirmation dialog
    function hideDeleteConfirmation() {
      confirmDialog.style.display = 'none';
      overlay.style.display = 'none';
      messageToDelete = null;
    }

    // Handle delete confirmation
    confirmDeleteBtn.addEventListener('click', async () => {
      if (messageToDelete) {
        await deleteMessage(messageToDelete);
      }
      hideDeleteConfirmation();
    });

    // Handle cancel delete
    cancelDeleteBtn.addEventListener('click', hideDeleteConfirmation);
    overlay.addEventListener('click', hideDeleteConfirmation);

    // Delete message from database
    async function deleteMessage(messageId) {
      try {
        if (currentMode === 'room') {
          // Delete from room
          await deleteDoc(doc(db, 'rooms', currentRoomId, 'messages', messageId));
        } else if (currentMode === 'dm') {
          // Delete from DM conversation
          const cid = convId(auth.currentUser.uid, currentPeer.uid);
          await deleteDoc(doc(db, 'conversations', cid, 'messages', messageId));
        }
      } catch (error) {
        console.error("Error deleting message:", error);
        alert("Failed to delete message. Please try again.");
      }
    }

    // ===== 11) HELPERS =====
    function escapeHTML(str){ return (str||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }