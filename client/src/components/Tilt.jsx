import { useRef, useState } from 'react';

/**
 * Tilt component that provides an interactive 3D perspective tilt effect
 * and cursor-tracking glow reflection (glare) on hover.
 */
export default function Tilt({ children, className = '', style = {}, max = 10, perspective = 800, ...props }) {
  const elementRef = useRef(null);
  const [coords, setCoords] = useState({ x: 0.5, y: 0.5 });
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerMove = (e) => {
    // Only apply tilt on mouse pointers (not touchscreens)
    if (e.pointerType !== 'mouse') return;
    if (!elementRef.current) return;

    const rect = elementRef.current.getBoundingClientRect();
    
    // Normalized coordinates (0 to 1) relative to element
    const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    
    setCoords({ x, y });
  };

  const handlePointerEnter = (e) => {
    if (e.pointerType !== 'mouse') return;
    setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    setCoords({ x: 0.5, y: 0.5 });
  };

  // Calculate rotation angles
  // rotateX is based on Y-axis distance from center (negative when mouse is in top half)
  // rotateY is based on X-axis distance from center (positive when mouse is in right half)
  const rotateX = isHovered ? (0.5 - coords.y) * max : 0;
  const rotateY = isHovered ? (coords.x - 0.5) * max : 0;

  const tiltStyle = {
    ...style,
    transform: `perspective(${perspective}px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`,
    transition: isHovered ? 'transform 0.1s cubic-bezier(0.25, 1, 0.5, 1)' : 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1), border-color var(--transition), box-shadow var(--transition)',
    transformStyle: 'preserve-3d',
    position: 'relative',
  };

  // Radial gradient glare overlay that follows the cursor
  const glowStyle = isHovered ? {
    content: '""',
    position: 'absolute',
    inset: 0,
    zIndex: 10,
    pointerEvents: 'none',
    borderRadius: 'inherit',
    background: `radial-gradient(circle 200px at ${coords.x * 100}% ${coords.y * 100}%, rgba(255, 255, 255, 0.08), transparent 75%)`,
    mixBlendMode: 'overlay',
    transition: 'background 0.05s ease',
  } : null;

  return (
    <div
      ref={elementRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={tiltStyle}
      className={className}
      {...props}
    >
      {children}
      {glowStyle && <div style={glowStyle} className="tilt-glow" />}
    </div>
  );
}
