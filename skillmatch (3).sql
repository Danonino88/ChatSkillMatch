-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 26-03-2026 a las 06:51:21
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `skillmatch`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `auditoria`
--

CREATE TABLE `auditoria` (
  `id_evento` int(11) NOT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  `accion` varchar(100) DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  `ip_origen` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `auditoria`
--

INSERT INTO `auditoria` (`id_evento`, `id_usuario`, `accion`, `fecha`, `ip_origen`) VALUES
(3, 3, 'REGISTRO', '2026-03-09 20:33:57', '::1'),
(4, 3, 'LOGIN', '2026-03-09 20:50:46', '::1'),
(5, 3, 'LOGIN', '2026-03-09 20:57:24', '::1'),
(6, 3, 'LOGIN', '2026-03-09 20:58:21', '::1'),
(7, 3, 'LOGIN', '2026-03-09 21:08:19', '::1'),
(8, 3, 'LOGIN', '2026-03-09 23:50:35', '::1'),
(9, 3, 'LOGIN', '2026-03-13 02:51:35', '::1'),
(10, 3, 'LOGIN', '2026-03-13 20:34:00', '::1');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `calificaciones`
--

CREATE TABLE `calificaciones` (
  `id_calificacion` int(11) NOT NULL,
  `id_proyecto` int(11) NOT NULL,
  `id_usuario` int(11) NOT NULL,
  `puntaje` decimal(3,2) DEFAULT NULL,
  `comentario` text DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `carreras`
--

CREATE TABLE `carreras` (
  `id_carrera` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `carreras`
--

INSERT INTO `carreras` (`id_carrera`, `nombre`) VALUES
(1, 'Ing. en Desarrollo y Gestion de Software'),
(2, 'Ing. Mecatronica'),
(3, 'Ing. Ambiental'),
(4, 'Ing. Redes');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `chatbot`
--

CREATE TABLE `chatbot` (
  `id_pregunta` int(11) NOT NULL,
  `pregunta` varchar(255) NOT NULL,
  `respuesta` text NOT NULL,
  `categoria` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `chatbot_config`
--

CREATE TABLE `chatbot_config` (
  `id` int(11) NOT NULL,
  `clave` varchar(50) NOT NULL,
  `valor` longtext NOT NULL,
  `actualizado_por` int(11) DEFAULT NULL,
  `fecha_actualizacion` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cvs`
--

CREATE TABLE `cvs` (
  `id_cv` int(11) NOT NULL,
  `id_estudiante` int(11) NOT NULL,
  `ruta_pdf` varchar(255) DEFAULT NULL,
  `fecha_generacion` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `empresas`
--

CREATE TABLE `empresas` (
  `id_empresa` int(11) NOT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  `razon_social` varchar(150) NOT NULL,
  `giro` varchar(100) DEFAULT NULL,
  `contacto` varchar(150) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `empresas`
--

INSERT INTO `empresas` (`id_empresa`, `id_usuario`, `razon_social`, `giro`, `contacto`) VALUES
(3, 15, 'Empresa Prueba5', 'Tecnología / Software', 'Victor Lopez');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `estudiantes`
--

CREATE TABLE `estudiantes` (
  `id_estudiante` int(11) NOT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  `matricula` varchar(20) NOT NULL,
  `carrera` varchar(100) DEFAULT NULL,
  `semestre` int(11) DEFAULT NULL,
  `competencias` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `estudiantes`
--

INSERT INTO `estudiantes` (`id_estudiante`, `id_usuario`, `matricula`, `carrera`, `semestre`, `competencias`) VALUES
(3, NULL, 'MAT000003', 'Ing. en Desarrollo y Gestión de Software', 7, NULL),
(6, 10, '2023371089', 'Ing. en Desarrollo y Gestión de Software', 7, NULL),
(7, 16, '2023371051', 'Ing. en Desarrollo y Gestión de Software', 7, NULL),
(8, 17, '111111111111', 'Ing. en Desarrollo y Gestión de Software', 7, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `evidencias`
--

CREATE TABLE `evidencias` (
  `id_evidencia` int(11) NOT NULL,
  `id_proyecto` int(11) NOT NULL,
  `ruta_archivo` varchar(255) DEFAULT NULL,
  `nombre_original` varchar(255) DEFAULT NULL,
  `tipo` varchar(50) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `tamano_bytes` int(11) DEFAULT NULL,
  `fecha_subida` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `evidencias`
--

INSERT INTO `evidencias` (`id_evidencia`, `id_proyecto`, `ruta_archivo`, `nombre_original`, `tipo`, `mime_type`, `tamano_bytes`, `fecha_subida`) VALUES
(4, 6, 'uploads/evidencias/453f2e8c6c396d60235c92b3e8e651017d2e13574a433d46379acfff7ba4f03c.pdf', NULL, 'manual|sha256:453f2e8c6c396d60235c92b3e8e651017d2e', NULL, NULL, '2026-03-10 00:42:44'),
(5, 7, 'evidencias/1774001997618-613406056.mp4', 'EduMochila prueba de funcionamiento.mp4', 'Video', 'video/mp4', 2584829, '2026-03-20 10:19:57'),
(6, 7, 'evidencias/1774002024313-378320278.pdf', 'Requerimientos EduMochila.pdf', 'pdf', 'application/pdf', 75849, '2026-03-20 10:20:24'),
(7, 7, 'evidencias/1774490394040-57154155.pdf', 'MetodologÃ­a de EvaluaciÃ³n Sumativa - Victor Guadalupe Lopez Cebreros.pdf', 'Archivo de inicio', 'application/pdf', 166617, '2026-03-26 01:59:54');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `horarios_profesores`
--

CREATE TABLE `horarios_profesores` (
  `id_horario` int(11) NOT NULL,
  `id_profesor` int(11) NOT NULL,
  `titulo` varchar(150) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `ruta_pdf` varchar(255) NOT NULL,
  `fecha_subida` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `postulaciones`
--

CREATE TABLE `postulaciones` (
  `id_postulacion` int(11) NOT NULL,
  `id_vacante` int(11) NOT NULL,
  `id_estudiante` int(11) NOT NULL,
  `estado` enum('pendiente','en_revision','aceptado','rechazado') DEFAULT 'pendiente',
  `fecha_postulacion` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `postulaciones`
--

INSERT INTO `postulaciones` (`id_postulacion`, `id_vacante`, `id_estudiante`, `estado`, `fecha_postulacion`) VALUES
(1, 1, 6, 'pendiente', '2026-03-25 19:50:17'),
(2, 3, 6, 'pendiente', '2026-03-26 02:03:03');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `profesores`
--

CREATE TABLE `profesores` (
  `id_profesor` int(11) NOT NULL,
  `departamento` varchar(100) DEFAULT NULL,
  `asignaturas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `proyectos`
--

CREATE TABLE `proyectos` (
  `id_proyecto` int(11) NOT NULL,
  `id_estudiante` int(11) NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `img_principal` varchar(255) DEFAULT NULL,
  `tecnologias` text DEFAULT NULL,
  `fecha_registro` date DEFAULT curdate(),
  `estado` enum('en progreso','completado','pausado') DEFAULT 'en progreso'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `proyectos`
--

INSERT INTO `proyectos` (`id_proyecto`, `id_estudiante`, `titulo`, `descripcion`, `img_principal`, `tecnologias`, `fecha_registro`, `estado`) VALUES
(6, 3, 'SkillMatch', 'Página vinculada a la UTEQ', NULL, NULL, '2026-03-09', ''),
(7, 6, 'EduMochila ', 'Mochila inteligente', 'proyectos/proyecto-1774005870593-744253517.jpeg', 'React,Node.js,MySQL,MongoDB,GitHub,CSS,Bootstrap,JavaScript', '2026-03-20', 'completado');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `roles`
--

CREATE TABLE `roles` (
  `id_rol` int(11) NOT NULL,
  `nombre_rol` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `roles`
--

INSERT INTO `roles` (`id_rol`, `nombre_rol`) VALUES
(1, 'admin'),
(3, 'empresa'),
(2, 'estudiante'),
(4, 'profesor');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id_usuario` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido` varchar(100) NOT NULL,
  `correo` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `id_rol` int(11) NOT NULL,
  `estado` enum('activo','inactivo') DEFAULT 'activo',
  `telefono` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`id_usuario`, `nombre`, `apellido`, `correo`, `password_hash`, `id_rol`, `estado`, `telefono`) VALUES
(3, 'Oscar Daniel', 'Mota Hernandez', '2024171013@uteq.edu.mx', '$2y$10$AC7.aM31gfT6xap0MYxVceEqY0P2CChuBdSlseKo9VXBh2kOO/Luy', 2, 'activo', NULL),
(10, 'Victor Guadalupe', 'Lopez  Cebreros', '2023371089@uteq.edu.mx', '$2b$10$p7xQEpRAea7sFO90YWL4BeE3nzafzfGQO9/FcGDtEk5MsW1siKg26', 2, 'activo', NULL),
(15, 'Empresa Prueba5', 'Victor Lopez', 'EmpresaGuille@gmail.com', '$2b$10$xELIgkmkCqG39DIiiG5kw.lZ.06PLira.Tav1FeMCXkl1d6Zb6Owq', 3, 'activo', NULL),
(16, 'Maxo', 'Juarez', '2023371051@uteq.edu.mx', '$2b$10$Ir6F1KjIKdn6EzjVhbJ1seSdc8Kq5lK/dbMggay/32Ud2xwyHA2jW', 2, 'activo', NULL),
(17, 'Victor Guadalupe', 'Lopez Cebreros', 'victorproroblox24@gmail.com', '$2b$10$qxYQ6pOixNfZjaGOLTNqN.NGneWLBUH/2mMtqdy4KF2Ar5phDpZ2C', 1, 'activo', NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `vacantes`
--

CREATE TABLE `vacantes` (
  `id_vacante` int(11) NOT NULL,
  `id_empresa` int(11) NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `categoria` varchar(100) DEFAULT NULL,
  `nivel` enum('JUNIOR','SEMI-SENIOR','SENIOR','LEAD') DEFAULT 'JUNIOR',
  `descripcion` text NOT NULL,
  `requisitos` text DEFAULT NULL,
  `estado` enum('abierta','cerrada','pausada') DEFAULT 'abierta',
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `vacantes`
--

INSERT INTO `vacantes` (`id_vacante`, `id_empresa`, `titulo`, `categoria`, `nivel`, `descripcion`, `requisitos`, `estado`, `fecha_registro`) VALUES
(1, 3, 'Desarrollador en PYTHON', 'Administración', 'SEMI-SENIOR', 'Debe automatizar el sistema de automatización  ', 'PY', 'abierta', '2026-03-24 07:28:04'),
(2, 3, 'Hola', 'Finanzas', 'LEAD', 'jdcjdjd', '', 'abierta', '2026-03-24 07:38:38'),
(3, 3, 'Desarrolador en java', 'Administración', 'SEMI-SENIOR', 'hshlkjjkf', 'xcbkj', 'abierta', '2026-03-26 02:01:41');

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `auditoria`
--
ALTER TABLE `auditoria`
  ADD PRIMARY KEY (`id_evento`),
  ADD KEY `id_usuario` (`id_usuario`);

--
-- Indices de la tabla `calificaciones`
--
ALTER TABLE `calificaciones`
  ADD PRIMARY KEY (`id_calificacion`),
  ADD KEY `id_proyecto` (`id_proyecto`),
  ADD KEY `id_usuario` (`id_usuario`);

--
-- Indices de la tabla `carreras`
--
ALTER TABLE `carreras`
  ADD PRIMARY KEY (`id_carrera`);

--
-- Indices de la tabla `chatbot`
--
ALTER TABLE `chatbot`
  ADD PRIMARY KEY (`id_pregunta`);

--
-- Indices de la tabla `chatbot_config`
--
ALTER TABLE `chatbot_config`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `clave` (`clave`),
  ADD KEY `actualizado_por` (`actualizado_por`);

--
-- Indices de la tabla `cvs`
--
ALTER TABLE `cvs`
  ADD PRIMARY KEY (`id_cv`),
  ADD KEY `id_estudiante` (`id_estudiante`);

--
-- Indices de la tabla `empresas`
--
ALTER TABLE `empresas`
  ADD PRIMARY KEY (`id_empresa`),
  ADD UNIQUE KEY `id_usuario` (`id_usuario`);

--
-- Indices de la tabla `estudiantes`
--
ALTER TABLE `estudiantes`
  ADD PRIMARY KEY (`id_estudiante`),
  ADD UNIQUE KEY `matricula` (`matricula`),
  ADD UNIQUE KEY `uq_estudiantes_id_usuario` (`id_usuario`);

--
-- Indices de la tabla `evidencias`
--
ALTER TABLE `evidencias`
  ADD PRIMARY KEY (`id_evidencia`),
  ADD KEY `id_proyecto` (`id_proyecto`);

--
-- Indices de la tabla `horarios_profesores`
--
ALTER TABLE `horarios_profesores`
  ADD PRIMARY KEY (`id_horario`),
  ADD KEY `id_profesor` (`id_profesor`);

--
-- Indices de la tabla `postulaciones`
--
ALTER TABLE `postulaciones`
  ADD PRIMARY KEY (`id_postulacion`),
  ADD UNIQUE KEY `unique_postulacion` (`id_vacante`,`id_estudiante`),
  ADD KEY `id_estudiante` (`id_estudiante`);

--
-- Indices de la tabla `profesores`
--
ALTER TABLE `profesores`
  ADD PRIMARY KEY (`id_profesor`);

--
-- Indices de la tabla `proyectos`
--
ALTER TABLE `proyectos`
  ADD PRIMARY KEY (`id_proyecto`),
  ADD KEY `id_estudiante` (`id_estudiante`);

--
-- Indices de la tabla `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id_rol`),
  ADD UNIQUE KEY `nombre_rol` (`nombre_rol`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id_usuario`),
  ADD UNIQUE KEY `correo` (`correo`),
  ADD KEY `id_rol` (`id_rol`);

--
-- Indices de la tabla `vacantes`
--
ALTER TABLE `vacantes`
  ADD PRIMARY KEY (`id_vacante`),
  ADD KEY `id_empresa` (`id_empresa`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `auditoria`
--
ALTER TABLE `auditoria`
  MODIFY `id_evento` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT de la tabla `calificaciones`
--
ALTER TABLE `calificaciones`
  MODIFY `id_calificacion` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `carreras`
--
ALTER TABLE `carreras`
  MODIFY `id_carrera` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT de la tabla `chatbot`
--
ALTER TABLE `chatbot`
  MODIFY `id_pregunta` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `chatbot_config`
--
ALTER TABLE `chatbot_config`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `cvs`
--
ALTER TABLE `cvs`
  MODIFY `id_cv` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `empresas`
--
ALTER TABLE `empresas`
  MODIFY `id_empresa` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT de la tabla `estudiantes`
--
ALTER TABLE `estudiantes`
  MODIFY `id_estudiante` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT de la tabla `evidencias`
--
ALTER TABLE `evidencias`
  MODIFY `id_evidencia` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT de la tabla `horarios_profesores`
--
ALTER TABLE `horarios_profesores`
  MODIFY `id_horario` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `postulaciones`
--
ALTER TABLE `postulaciones`
  MODIFY `id_postulacion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT de la tabla `proyectos`
--
ALTER TABLE `proyectos`
  MODIFY `id_proyecto` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT de la tabla `roles`
--
ALTER TABLE `roles`
  MODIFY `id_rol` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id_usuario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- AUTO_INCREMENT de la tabla `vacantes`
--
ALTER TABLE `vacantes`
  MODIFY `id_vacante` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `auditoria`
--
ALTER TABLE `auditoria`
  ADD CONSTRAINT `auditoria_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `calificaciones`
--
ALTER TABLE `calificaciones`
  ADD CONSTRAINT `calificaciones_ibfk_1` FOREIGN KEY (`id_proyecto`) REFERENCES `proyectos` (`id_proyecto`),
  ADD CONSTRAINT `calificaciones_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `chatbot_config`
--
ALTER TABLE `chatbot_config`
  ADD CONSTRAINT `chatbot_config_ibfk_1` FOREIGN KEY (`actualizado_por`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `cvs`
--
ALTER TABLE `cvs`
  ADD CONSTRAINT `cvs_ibfk_1` FOREIGN KEY (`id_estudiante`) REFERENCES `estudiantes` (`id_estudiante`);

--
-- Filtros para la tabla `empresas`
--
ALTER TABLE `empresas`
  ADD CONSTRAINT `empresas_ibfk_1` FOREIGN KEY (`id_empresa`) REFERENCES `usuarios` (`id_usuario`),
  ADD CONSTRAINT `fk_empresa_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE;

--
-- Filtros para la tabla `estudiantes`
--
ALTER TABLE `estudiantes`
  ADD CONSTRAINT `fk_estudiante_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_estudiantes_usuarios` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Filtros para la tabla `evidencias`
--
ALTER TABLE `evidencias`
  ADD CONSTRAINT `evidencias_ibfk_1` FOREIGN KEY (`id_proyecto`) REFERENCES `proyectos` (`id_proyecto`);

--
-- Filtros para la tabla `horarios_profesores`
--
ALTER TABLE `horarios_profesores`
  ADD CONSTRAINT `horarios_profesores_ibfk_1` FOREIGN KEY (`id_profesor`) REFERENCES `profesores` (`id_profesor`);

--
-- Filtros para la tabla `postulaciones`
--
ALTER TABLE `postulaciones`
  ADD CONSTRAINT `postulaciones_ibfk_1` FOREIGN KEY (`id_vacante`) REFERENCES `vacantes` (`id_vacante`) ON DELETE CASCADE,
  ADD CONSTRAINT `postulaciones_ibfk_2` FOREIGN KEY (`id_estudiante`) REFERENCES `estudiantes` (`id_estudiante`) ON DELETE CASCADE;

--
-- Filtros para la tabla `profesores`
--
ALTER TABLE `profesores`
  ADD CONSTRAINT `profesores_ibfk_1` FOREIGN KEY (`id_profesor`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `proyectos`
--
ALTER TABLE `proyectos`
  ADD CONSTRAINT `proyectos_ibfk_1` FOREIGN KEY (`id_estudiante`) REFERENCES `estudiantes` (`id_estudiante`);

--
-- Filtros para la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`id_rol`) REFERENCES `roles` (`id_rol`);

--
-- Filtros para la tabla `vacantes`
--
ALTER TABLE `vacantes`
  ADD CONSTRAINT `vacantes_ibfk_1` FOREIGN KEY (`id_empresa`) REFERENCES `empresas` (`id_empresa`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
