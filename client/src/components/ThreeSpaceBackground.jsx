import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function ThreeSpaceBackground({ activeTab }) {
  const mountRef = useRef(null);
  const activeTabRef = useRef(activeTab);

  // Keep ref up to date for the animation loop
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    // 1. Scene, Camera, and Renderer setup
    const w = currentMount.clientWidth;
    const h = currentMount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030508');
    scene.fog = new THREE.FogExp2('#030508', 0.015);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.z = 10;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    currentMount.appendChild(renderer.domElement);

    // 2. Lights
    const ambientLight = new THREE.AmbientLight('#2a1b4e', 1.2); // deep cosmic ambient
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight('#818cf8', 5, 20);
    pointLight.position.set(0, 5, 5);
    scene.add(pointLight);

    // 3. Particles (Starfield / Space dust)
    const particleCount = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      // Distribute in a spherical cloud
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.random() * 12 + 2; // radius between 2 and 14

      positions[i] = r * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = r * Math.cos(phi);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.045,
      color: '#818cf8',
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    const starField = new THREE.Points(geometry, material);
    scene.add(starField);

    // 4. Mouse movement tracking for Lerp Parallax
    let mouseX = 0;
    let mouseY = 0;
    let targetRotX = 0;
    let targetRotY = 0;

    const handleMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) - 0.5;
      mouseY = (e.clientY / window.innerHeight) - 0.5;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // 5. Scroll tracking
    let scrollY = 0;
    const handleScroll = () => {
      scrollY = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // 6. Animation loop
    const clock = new THREE.Clock();
    let animId;

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const tab = activeTabRef.current;

      // Color targets
      let targetColor;
      let targetAmbientColor;
      let targetLightColor;

      if (tab === 'antigravity') {
        // Red, Gold, Purple nebula
        targetColor = new THREE.Color('#ef4444'); // Red stars
        targetAmbientColor = new THREE.Color('#4c1d95'); // Deep purple ambient
        targetLightColor = new THREE.Color('#e0a82e'); // Gold point light
      } else {
        // Cyan, Blue, Indigo nebula
        targetColor = new THREE.Color('#06b6d4'); // Cyan stars
        targetAmbientColor = new THREE.Color('#1e1b4b'); // Deep indigo ambient
        targetLightColor = new THREE.Color('#818cf8'); // Indigo point light
      }

      // Smooth color transitions
      material.color.lerp(targetColor, 0.05);
      ambientLight.color.lerp(targetAmbientColor, 0.05);
      pointLight.color.lerp(targetLightColor, 0.05);

      // Slow rotation of the starfield
      starField.rotation.y = elapsed * 0.025;
      starField.rotation.x = elapsed * 0.01;

      // PointLight orbital path
      pointLight.position.x = Math.sin(elapsed * 0.5) * 6;
      pointLight.position.y = Math.cos(elapsed * 0.7) * 5;

      // Mouse Parallax Lerping
      targetRotX = mouseY * 0.4;
      targetRotY = mouseX * 0.4;
      camera.position.x += (targetRotY * 12 - camera.position.x) * 0.05;
      camera.position.y += (-targetRotX * 12 - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);

      // Scroll camera zoom depth
      camera.position.z = 10 - Math.min(scrollY * 0.003, 4);

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    };

    animate();

    // 7. Responsive resizing
    const handleResize = () => {
      if (!currentMount) return;
      const wWidth = currentMount.clientWidth;
      const wHeight = currentMount.clientHeight;

      camera.aspect = wWidth / wHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(wWidth, wHeight);
    };
    window.addEventListener('resize', handleResize);

    // CLEANUP
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none'
      }}
    />
  );
}
